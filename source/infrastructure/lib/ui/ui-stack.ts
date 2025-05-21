/**********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                                *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import { Aws, StackProps, Stack, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cr from "aws-cdk-lib/custom-resources";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { SystemConfig } from "../shared/types";
import { PortalConstruct } from "../ui/ui-portal";
import { UserConstruct } from "../user/user-construct";

interface UIStackProps extends StackProps {
  readonly config: SystemConfig;
}

export interface UIStackOutputs {
  readonly mainPortalConstruct: PortalConstruct;
  readonly clientPortalConstruct: PortalConstruct;
  readonly userConstruct?: UserConstruct;
}

export class UIStack extends Stack implements UIStackOutputs {
  public mainPortalConstruct: PortalConstruct;
  public clientPortalConstruct: PortalConstruct;
  public userConstruct?: UserConstruct;

  constructor(scope: Construct, id: string, props: UIStackProps) {
    super(scope, id, props);

    const mainPortalConstruct = new PortalConstruct(this, "MainUI", {
      responseHeadersPolicyName: `SecHdr${Aws.REGION}${Aws.STACK_NAME}-main`,
    });
    const clientPortalConstruct = new PortalConstruct(this, "ClientUI", {
      uiSourcePath: "../cs-portal/dist",
      responseHeadersPolicyName: `SecHdr${Aws.REGION}${Aws.STACK_NAME}-client`,
    });

    // Create Lambda function to update CloudFront
    const updateCloudFrontFunction = new lambda.Function(this, 'UpdateCloudFrontFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
        const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');

        exports.handler = async (event) => {
          try {

            const cloudfront = new CloudFrontClient({});
            const cloudformation = new CloudFormationClient({});

            const rootStackName = process.env.ROOT_STACK_NAME;
            const distributionId = process.env.DISTRIBUTION_ID;

            if (!rootStackName || !distributionId) {
              throw new Error('Missing environment variables ROOT_STACK_NAME or DISTRIBUTION_ID');
            }

            console.log('Environment variables:', {
              ROOT_STACK_NAME: rootStackName,
              DISTRIBUTION_ID: distributionId
            });

            const stackRes = await cloudformation.send(new DescribeStacksCommand({ StackName: rootStackName }));
            const outputs = stackRes.Stacks[0].Outputs;
            const albEndpoint = outputs.find(o => o.OutputKey === 'ALBEndpointAddress')?.OutputValue;

            if (!albEndpoint) {
              throw new Error('ALB endpoint not found in stack outputs');
            }

            const distributionRes = await cloudfront.send(new GetDistributionConfigCommand({ Id: distributionId }));
            const config = distributionRes.DistributionConfig;
            const etag = distributionRes.ETag;

            console.log('Original configuration:', JSON.stringify(config, null, 2));

            const updatedOrigins = config.Origins.Items.map(origin => {
              // 如果是我们要替换的 Origin，跳过
              if (origin.Id === 'OriginForALB') {
                return null;
              }
              // 确保所有必需的字段都存在
              return {
                ...origin,
                CustomHeaders: {
                  Quantity: 0
                },
                OriginCustomHeaders: {
                  Quantity: 0,
                  Items: []
                }
              };
            }).filter(Boolean); // 移除 null 值

            // 添加新的 ALB Origin
            updatedOrigins.push({
              Id: 'OriginForALB',
              DomainName: albEndpoint,
              OriginPath: '',
              CustomHeaders: {
                Quantity: 0
              },
              CustomOriginConfig: {
                HTTPPort: 80,
                HTTPSPort: 443,
                OriginProtocolPolicy: 'http-only',
                OriginSslProtocols: {
                  Quantity: 1,
                  Items: ['TLSv1.2']
                },
                OriginReadTimeout: 30,
                OriginKeepaliveTimeout: 60
              },
              ConnectionAttempts: 3,
              ConnectionTimeout: 10,
              OriginShield: {
                Enabled: false
              },
              OriginAccessControlId: '',
              OriginCustomHeaders: {
                Quantity: 0,
                Items: []
              }
            });

            // 4. 构造新的 CacheBehavior（针对 /stream*）
            const updatedCacheBehaviors = (config.CacheBehaviors?.Items || [])
              .filter(b => b.PathPattern !== '/stream*')
              .map(behavior => ({
                ...behavior,
                CustomHeaders: {
                  Quantity: 0
                },
                OriginCustomHeaders: {
                  Quantity: 0,
                  Items: []
                },
                SmoothStreaming: false,
                Compress: true,
                FieldLevelEncryptionId: '',
                TrustedSigners: {
                  Enabled: false,
                  Quantity: 0
                },
                TrustedKeyGroups: {
                  Enabled: false,
                  Quantity: 0
                },
                LambdaFunctionAssociations: {
                  Quantity: 0
                },
                FunctionAssociations: {
                  Quantity: 0
                },
                ForwardedValues: {
                  ...behavior.ForwardedValues,
                  QueryStringCacheKeys: {
                    Quantity: 0,
                    Items: []
                  },
                  QueryString: true,
                  Headers: {
                    Quantity: 13,
                    Items: [
                      'Host', 'Origin', 'Authorization', 'Oidc-Info', 'Content-Type', 'Accept',
                      'Accept-Encoding', 'Accept-Language', 'Referer', 'User-Agent',
                      'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Requested-With'
                    ]
                  },
                  Cookies: {
                    Forward: 'all',
                    WhitelistedNames: {
                      Quantity: 0,
                      Items: []
                    }
                  }
                }
              }));

            updatedCacheBehaviors.push({
              PathPattern: '/stream*',
              TargetOriginId: 'OriginForALB',
              ViewerProtocolPolicy: 'https-only',
              CustomHeaders: {
                Quantity: 0
              },
              AllowedMethods: {
                Quantity: 7,
                Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
                CachedMethods: {
                  Quantity: 3,
                  Items: ['GET', 'HEAD', 'OPTIONS']
                }
              },
              ForwardedValues: {
                QueryString: true,
                Cookies: {
                  Forward: 'all',
                  WhitelistedNames: {
                    Quantity: 0,
                    Items: []
                  }
                },
                Headers: {
                  Quantity: 13,
                  Items: [
                    'Host', 'Origin', 'Authorization', 'Oidc-Info', 'Content-Type', 'Accept',
                    'Accept-Encoding', 'Accept-Language', 'Referer', 'User-Agent',
                    'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Requested-With'
                  ]
                },
                QueryStringCacheKeys: {
                  Quantity: 0,
                  Items: []
                }
              },
              MinTTL: 0,
              DefaultTTL: 0,
              MaxTTL: 0,
              OriginCustomHeaders: {
                Quantity: 0,
                Items: []
              },
              SmoothStreaming: false,
              Compress: true,
              FieldLevelEncryptionId: '',
              TrustedSigners: {
                Enabled: false,
                Quantity: 0
              },
              TrustedKeyGroups: {
                Enabled: false,
                Quantity: 0
              },
              LambdaFunctionAssociations: {
                Quantity: 0
              },
              FunctionAssociations: {
                Quantity: 0
              }
            });

            // 5. 提交更新
            const finalConfig = {
              ...config,
              Origins: {
                Quantity: updatedOrigins.length,
                Items: updatedOrigins
              },
              DefaultCacheBehavior: {
                ...config.DefaultCacheBehavior,
                CustomHeaders: {
                  Quantity: 0
                },
                OriginCustomHeaders: {
                  Quantity: 0,
                  Items: []
                },
                SmoothStreaming: false,
                Compress: true,
                FieldLevelEncryptionId: '',
                TrustedSigners: {
                  Enabled: false,
                  Quantity: 0
                },
                TrustedKeyGroups: {
                  Enabled: false,
                  Quantity: 0
                },
                LambdaFunctionAssociations: {
                  Quantity: 0
                },
                FunctionAssociations: {
                  Quantity: 0
                },
                ForwardedValues: {
                  ...config.DefaultCacheBehavior.ForwardedValues,
                  QueryString: true,
                  Cookies: {
                    Forward: 'all',
                    WhitelistedNames: {
                      Quantity: 0,
                      Items: []
                    }
                  },
                  Headers: {
                    Quantity: 13,
                    Items: [
                      'Host', 'Origin', 'Authorization', 'Oidc-Info', 'Content-Type', 'Accept',
                      'Accept-Encoding', 'Accept-Language', 'Referer', 'User-Agent',
                      'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Requested-With'
                    ]
                  },
                  QueryStringCacheKeys: {
                    Quantity: 0,
                    Items: []
                  }
                }
              },
              CacheBehaviors: {
                Quantity: updatedCacheBehaviors.length,
                Items: updatedCacheBehaviors
              }
            };

            // 打印最终配置以便调试
            console.log('Final configuration:', JSON.stringify(finalConfig, null, 2));
            console.log('DefaultCacheBehavior:', JSON.stringify(finalConfig.DefaultCacheBehavior, null, 2));
            console.log('Origins:', JSON.stringify(finalConfig.Origins, null, 2));
            console.log('CacheBehaviors:', JSON.stringify(finalConfig.CacheBehaviors, null, 2));

            await cloudfront.send(new UpdateDistributionCommand({
              Id: distributionId,
              IfMatch: etag,
              DistributionConfig: finalConfig
            }));

            console.log('CloudFront distribution updated successfully.');
            return { PhysicalResourceId: 'UpdateCloudFront' };

          } catch (err) {
            console.error('Update failed:', err);
            throw err;
          }
        }
      `),
      timeout: Duration.minutes(5),
      environment: {
        ROOT_STACK_NAME: id.replace('-frontend', ''),
        DISTRIBUTION_ID: (mainPortalConstruct.node.findChild('Distribution') as cloudfront.CfnDistribution).attrId
      }
    });

    updateCloudFrontFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudfront:GetDistribution',
        'cloudfront:GetDistributionConfig',
        'cloudfront:UpdateDistribution',
        'cloudformation:DescribeStacks',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: ['*']
    }));

    new cr.AwsCustomResource(this, 'WatchALBEndpoint', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: updateCloudFrontFunction.functionName,
          InvocationType: 'RequestResponse'
        },
        physicalResourceId: cr.PhysicalResourceId.of('WatchALBEndpoint')
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: updateCloudFrontFunction.functionName,
          InvocationType: 'RequestResponse'
        },
        physicalResourceId: cr.PhysicalResourceId.of('WatchALBEndpoint')
      },
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [updateCloudFrontFunction.functionArn]
        })
      ])
    });

    if (!props.config.deployRegion.startsWith("cn-")) {
      const userConstruct = new UserConstruct(this, "User", {
        deployRegion: props.config.deployRegion,
        adminEmail: props.config.email,
        callbackUrls: [
          `https://${clientPortalConstruct.portalUrl}/signin`,
          `https://${mainPortalConstruct.portalUrl}/signin`
        ],
        logoutUrls: [
          `https://${clientPortalConstruct.portalUrl}`,
          `https://${mainPortalConstruct.portalUrl}`
        ],
      });
      this.userConstruct = userConstruct;
      // Add CfnOutputs to export values
      new CfnOutput(this, 'UserPoolId', {
        value: userConstruct.userPoolId,
        exportName: `${id}-user-pool-id`
      });

      new CfnOutput(this, 'OidcClientId', {
        value: userConstruct.oidcClientId,
        exportName: `${id}-oidc-client-id`
      });

      new CfnOutput(this, 'OidcIssuer', {
        value: userConstruct.oidcIssuer,
        exportName: `${id}-oidc-issuer`
      });

      new CfnOutput(this, 'OidcLogoutUrl', {
        value: userConstruct.oidcLogoutUrl,
        exportName: `${id}-oidc-logout-url`
      });
      new CfnOutput(this, 'OidcRegion', {
        value: userConstruct.oidcRegion,
        exportName: `${id}-oidc-region`
      });
      new CfnOutput(this, 'OidcDomain', {
        value: userConstruct.oidcDomain,
        exportName: `${id}-oidc-domain`
      });
    }
    this.mainPortalConstruct = mainPortalConstruct;
    this.clientPortalConstruct = clientPortalConstruct;

    new CfnOutput(this, 'PortalBucketName', {
      value: mainPortalConstruct.portalBucket.bucketName,
      exportName: `${id}-portal-bucket-name`
    });

    new CfnOutput(this, 'ClientPortalBucketName', {
      value: clientPortalConstruct.portalBucket.bucketName,
      exportName: `${id}-client-portal-bucket-name`
    });

    new CfnOutput(this, 'PortalUrl', {
      value: mainPortalConstruct.portalUrl,
      exportName: `${id}-portal-url`
    });

    new CfnOutput(this, 'ClientPortalUrl', {
      value: clientPortalConstruct.portalUrl,
      exportName: `${id}-client-portal-url`
    });
  }
}
