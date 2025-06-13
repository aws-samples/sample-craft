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
  public updateCloudFrontFunction: lambda.Function;
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
    this.updateCloudFrontFunction = new lambda.Function(this, 'UpdateCloudFrontFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const https = require('https');
const url = require('url');
const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');

exports.handler = async (event, context) => {
  let responseStatus = 'SUCCESS';
  let responseData = {};
  try {
    const cloudfront = new CloudFrontClient({});
    const cloudformation = new CloudFormationClient({});
    
    const rootStackName = process.env.ROOT_STACK_NAME;
    const distributionId = process.env.DISTRIBUTION_ID;

    if (!rootStackName || !distributionId) {
      throw new Error('Missing environment variables ROOT_STACK_NAME or DISTRIBUTION_ID');
    }

    const stackRes = await cloudformation.send(new DescribeStacksCommand({ StackName: rootStackName }));
    const outputs = stackRes.Stacks[0].Outputs;
    const albEndpoint = outputs?.find(o => o.OutputKey === 'ALBEndpointAddress')?.OutputValue;

    if (!albEndpoint) {
      throw new Error('ALB endpoint not found in stack outputs');
    }

    const distributionRes = await cloudfront.send(new GetDistributionConfigCommand({ Id: distributionId }));
    const existingConfig = distributionRes.DistributionConfig;
    const etag = distributionRes.ETag;

    // Add ALB origin to existing origins
    const existingOrigins = Array.isArray(existingConfig.Origins.Items) 
      ? existingConfig.Origins.Items
      : [];

    const millstr = Date.now();
    
    const newOrigins = [
      ...existingOrigins,
      // Add ALB origin
      {
        Id: 'OriginForALB' + millstr,
        DomainName: albEndpoint,
        OriginPath: '',
        CustomOriginConfig: {
          HTTPPort: 80,
          HTTPSPort: 443,
          OriginProtocolPolicy: 'http-only',
          OriginSslProtocols: {
            Quantity: 1,
            Items: ['TLSv1.2']
          },
          OriginKeepaliveTimeout: 60,
          OriginReadTimeout: 30
        },
        CustomHeaders: {
          Quantity: 0
        },
        ConnectionAttempts: 3,
        ConnectionTimeout: 10,
        OriginShield: { Enabled: false },
        OriginAccessControlId: ''
      }
    ];

    // Add cache behavior for ALB
    const newCacheBehaviors = [
      {
        PathPattern: '/stream*',
        TargetOriginId: 'OriginForALB' + millstr,
        ViewerProtocolPolicy: 'https-only',
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
            Quantity: 14,
            Items: [
              'Host',
              'Origin',
              'Authorization',
              'Oidc-Info',
              'Content-Type',
              'Accept',
              'Accept-Encoding',
              'Accept-Language',
              'Referer',
              'User-Agent',
              'X-Forwarded-For',
              'X-Forwarded-Proto',
              'X-Requested-With',
              'Cache-Control'
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
        SmoothStreaming: false,
        Compress: true,
        FieldLevelEncryptionId: '',
        TrustedSigners: {
          Enabled: false,
          Quantity: 0,
          Items: []
        },
        TrustedKeyGroups: {
          Enabled: false,
          Quantity: 0,
          Items: []
        },
        LambdaFunctionAssociations: {
          Quantity: 0,
          Items: []
        },
        FunctionAssociations: {
          Quantity: 0,
          Items: []
        }
      }
    ];

    const finalConfig = {
      ...existingConfig,
      Origins: {
        Quantity: newOrigins.length,
        Items: newOrigins
      },
      DefaultCacheBehavior: existingConfig.DefaultCacheBehavior,
      CacheBehaviors: {
        Quantity: newCacheBehaviors.length,
        Items: newCacheBehaviors
      }
    };

    await cloudfront.send(new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: etag,
      DistributionConfig: finalConfig
    }));

    responseStatus = 'SUCCESS';
    responseData = { Message: 'CloudFront distribution updated successfully' };
  } catch (err) {
    console.error('Update failed:', err);
    responseStatus = 'FAILED';
    responseData = { Error: err.message };
  }

  // 检查是否有 ResponseURL
  if (!event.ResponseURL) {
    console.log('No ResponseURL found, returning result directly');
    return {
      statusCode: responseStatus === 'SUCCESS' ? 200 : 500,
      body: JSON.stringify(responseData)
    };
  }

  await sendCloudFormationResponse(event, context, responseStatus, responseData, 'UpdateCloudFront');
};

async function sendCloudFormationResponse(event, context, responseStatus, responseData, physicalResourceId) {
  if (!event.ResponseURL) {
    console.error('ResponseURL is undefined');
    return;
  }

  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: responseStatus === 'FAILED' ? responseData.Error || 'Error' : 'See CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: responseData
  });

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': Buffer.byteLength(responseBody)
    }
  };

  await new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      resolve();
    });
    request.on('error', (error) => {
      reject(error);
    });
    request.write(responseBody);
    request.end();
  });
}

      `),
      timeout: Duration.minutes(5),
      environment: {
        ROOT_STACK_NAME: id.replace('-frontend', ''),
        DISTRIBUTION_ID: (mainPortalConstruct.node.findChild('Distribution') as cloudfront.CfnDistribution).attrId
      }
    });

    this.updateCloudFrontFunction.addToRolePolicy(new iam.PolicyStatement({
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
