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

import { App, CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from "dotenv";
import { getConfig } from "./config";
import { SystemConfig } from "../lib/shared/types";
import { SharedConstruct, SharedConstructOutputs } from "../lib/shared/shared-construct";
import { ApiConstruct, ApiConstructOutputs } from "../lib/api/api-stack";
import { ModelConstruct, ModelConstructOutputs } from "../lib/model/model-construct";
import { KnowledgeBaseStack, KnowledgeBaseStackOutputs } from "../lib/knowledge-base/knowledge-base-stack";
import { ChatStack, ChatStackOutputs } from "../lib/chat/chat-stack";
import { WorkspaceStack } from "../lib/workspace/workspace-stack";
import { UIStack } from "../lib/ui/ui-stack";
import { Fn } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { Aws } from "aws-cdk-lib";

dotenv.config();

export interface RootStackProps extends StackProps {
  readonly config: SystemConfig;
  readonly oidcLogoutUrl?: string;
  readonly portalBucketName: string;
  readonly portalUrl: string;
  readonly env?: {
    account: string | undefined;
    region: string;
  };
  readonly userPoolId?: string;
  readonly oidcClientId?: string;
  readonly oidcIssuer?: string;
}

export class RootStack extends Stack {
  public sharedConstruct: SharedConstructOutputs;
  public apiConstruct: ApiConstructOutputs;
  public modelConstruct: ModelConstructOutputs;
  public config: SystemConfig;
  public chatStack: ChatStack | undefined;
  // private isChinaRegion: boolean;

  constructor(scope: Construct, id: string, props: RootStackProps) {
    super(scope, id, props);
    this.templateOptions.description = "(SO8034) - Intelli-Agent";

    const sharedConstruct = new SharedConstruct(this, "shared-construct", {
      config: props.config,
    });

    let knowledgeBaseStack: KnowledgeBaseStack = {} as KnowledgeBaseStack;
    let knowledgeBaseStackOutputs: KnowledgeBaseStackOutputs = {} as KnowledgeBaseStackOutputs;
    let chatStackOutputs: ChatStackOutputs = {} as ChatStackOutputs;
    const isChinaRegion = props.env?.region.startsWith('cn-');

    const modelConstruct = new ModelConstruct(this, "model-construct", {
      config: props.config,
      sharedConstructOutputs: sharedConstruct,
    });
    modelConstruct.node.addDependency(sharedConstruct);

    if (props.config.knowledgeBase.enabled && props.config.knowledgeBase.knowledgeBaseType.intelliAgentKb.enabled) {
      knowledgeBaseStack = new KnowledgeBaseStack(this, "knowledge-base-stack", {
        config: props.config,
        sharedConstructOutputs: sharedConstruct,
        modelConstructOutputs: modelConstruct,
        uiPortalBucketName: props.portalBucketName,
      });
      knowledgeBaseStack.node.addDependency(sharedConstruct);
      knowledgeBaseStack.node.addDependency(modelConstruct);
      knowledgeBaseStackOutputs = knowledgeBaseStack;
    }

    // if (props.config.chat.enabled) {
      this.chatStack = new ChatStack(this, "chat-stack", {
        config: props.config,
        sharedConstructOutputs: sharedConstruct,
        modelConstructOutputs: modelConstruct,
        domainEndpoint: knowledgeBaseStackOutputs.aosDomainEndpoint,
      });
      chatStackOutputs = this.chatStack;
      new CfnOutput(this, "ALB Endpoint Address", {
        value: this.chatStack.albDomainEndpoint,
      });

    // }
    
    const apiConstruct = new ApiConstruct(this, "api-construct", {
      config: props.config,
      sharedConstructOutputs: sharedConstruct,
      modelConstructOutputs: modelConstruct,
      knowledgeBaseStackOutputs: knowledgeBaseStackOutputs,
      chatStackOutputs: chatStackOutputs
    });
    apiConstruct.node.addDependency(sharedConstruct);
    apiConstruct.node.addDependency(modelConstruct);

    this.sharedConstruct = sharedConstruct;
    this.apiConstruct = apiConstruct;
    this.modelConstruct = modelConstruct;
    this.config = props.config;

    new CfnOutput(this, "API Endpoint Address", {
      value: apiConstruct.apiEndpoint,
    });
    new CfnOutput(this, "Web Portal URL", {
      value: props.portalUrl,
      description: "Web portal url",
    });
    // new CfnOutput(this, "WebSocket Endpoint Address", {
    //   value: apiConstruct.wsEndpoint,
    // });
    if (!isChinaRegion) {
      new CfnOutput(this, "OIDC Client ID", {
        value: props.oidcClientId || '',
      });
      new CfnOutput(this, "User Pool ID", {
        value: props.userPoolId || '',
      });
    }
  }
}


const config = getConfig();

// For development, use account/region from CDK CLI
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1",
};

const app = new App();
let stackName = "ai-customer-service"
if(config.prefix && config.prefix.trim().length > 0){
  stackName = `${config.prefix}-ai-customer-service`;
}

const uiStack = new UIStack(app, `${stackName}-frontend`, {
  config: config,
  env: devEnv,
  suppressTemplateIndentation: true,
});

const rootStack = new RootStack(app, stackName, {
  config,
  env: devEnv, 
  portalBucketName: Fn.importValue(`${stackName}-frontend-portal-bucket-name`),
  portalUrl: Fn.importValue(`${stackName}-frontend-portal-url`),
  suppressTemplateIndentation: true,
  ...(!(devEnv?.region.startsWith('cn-')) && {
    userPoolId: Fn.importValue(`${stackName}-frontend-user-pool-id`),
    oidcClientId: Fn.importValue(`${stackName}-frontend-oidc-client-id`),
    oidcIssuer: Fn.importValue(`${stackName}-frontend-oidc-issuer`),
    oidcLogoutUrl: Fn.importValue(`${stackName}-frontend-oidc-logout-url`),
  }),
});


if (rootStack.chatStack?.loadBalancer) {
  const cfnDistribution = uiStack.node.findChild('MainUI').node.findChild('Distribution') as cloudfront.CfnDistribution;
  const existingConfig = cfnDistribution.distributionConfig as cloudfront.CfnDistribution.DistributionConfigProperty;
  
  // Add ALB origin to existing origins
  const existingOrigins = Array.isArray(existingConfig.origins) 
    ? existingConfig.origins as cloudfront.CfnDistribution.OriginProperty[]
    : [];
  
  const s3Config = existingOrigins[0]?.s3OriginConfig as cloudfront.CfnDistribution.S3OriginConfigProperty;
  
  const newOrigins = [
    // Convert existing S3 origin to use PascalCase properties
    {
      Id: existingOrigins[0]?.id,
      DomainName: existingOrigins[0]?.domainName,
      S3OriginConfig: {
        OriginAccessIdentity: s3Config?.originAccessIdentity
      }
    },
    // Add ALB origin
    {
      Id: `OriginFor${rootStack.chatStack.loadBalancer.loadBalancerName}`,
      DomainName: rootStack.chatStack.loadBalancer.loadBalancerDnsName,
      CustomOriginConfig: {
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: 'http-only',
        OriginSSLProtocols: ['TLSv1.2'],
        OriginKeepaliveTimeout: 60,
        OriginReadTimeout: 30
      }
    }
  ];
  cfnDistribution.addPropertyOverride('DistributionConfig.Origins', newOrigins);

  // Add cache behavior for ALB
  const newCacheBehaviors = [
    {
      PathPattern: '/stream*',
      TargetOriginId: `OriginFor${rootStack.chatStack.loadBalancer.loadBalancerName}`,
      ViewerProtocolPolicy: 'https-only',
      AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      CachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      ForwardedValues: {
        QueryString: true,
        Cookies: { Forward: 'all' },
        Headers: [
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
      MinTTL: 0,
      DefaultTTL: 0,
      MaxTTL: 0
    }
  ];
  cfnDistribution.addPropertyOverride('DistributionConfig.CacheBehaviors', newCacheBehaviors);

  // Update default cache behavior to specify headers explicitly
  const defaultCacheBehavior = {
    TargetOriginId: existingOrigins[0]?.id,
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: ['GET', 'HEAD'],
    CachedMethods: ['GET', 'HEAD'],
    ForwardedValues: {
      QueryString: true,
      Cookies: { Forward: 'none' },
      Headers: [] 
    },
    TrustedSigners: [],
    SmoothStreaming: false
  };
  cfnDistribution.addPropertyOverride('DistributionConfig.DefaultCacheBehavior', defaultCacheBehavior);
}

const workspaceStack = new WorkspaceStack(app, `${stackName}-workspace`, {
  env: devEnv,
  config: config,
  sharedConstructOutputs: rootStack.sharedConstruct,
  apiConstructOutputs: rootStack.apiConstruct,
  modelConstructOutputs: rootStack.modelConstruct,
  portalBucketName: Fn.importValue(`${stackName}-frontend-portal-bucket-name`),
  clientPortalBucketName: Fn.importValue(`${stackName}-frontend-client-portal-bucket-name`),
  portalUrl: Fn.importValue(`${stackName}-frontend-portal-url`),
  clientPortalUrl: Fn.importValue(`${stackName}-frontend-client-portal-url`),
  suppressTemplateIndentation: true,
  ...(!(devEnv?.region.startsWith('cn-')) && {
    userPoolId: Fn.importValue(`${stackName}-frontend-user-pool-id`),
    oidcClientId: Fn.importValue(`${stackName}-frontend-oidc-client-id`),
    oidcIssuer: Fn.importValue(`${stackName}-frontend-oidc-issuer`),
    oidcLogoutUrl: Fn.importValue(`${stackName}-frontend-oidc-logout-url`),
    oidcRegion: Fn.importValue(`${stackName}-frontend-oidc-region`),
    oidcDomain: Fn.importValue(`${stackName}-frontend-oidc-domain`)
  }),
  ...(config.chat.enabled && {
     albUrl: rootStack.chatStack?.albDomainEndpoint,
  })
});

workspaceStack.addDependency(rootStack);
workspaceStack.addDependency(uiStack);

app.synth();
