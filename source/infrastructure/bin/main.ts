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
import { ModelConstruct, ModelConstructOutputs } from "../lib/model/model-construct";
import { KnowledgeBaseStack, KnowledgeBaseStackOutputs } from "../lib/knowledge-base/kb-construct";
import { Fn } from "aws-cdk-lib";

dotenv.config();

export interface RootStackProps extends StackProps {
  readonly config: SystemConfig;
  readonly oidcLogoutUrl?: string;
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
  public modelConstruct: ModelConstructOutputs;
  public config: SystemConfig;

  constructor(scope: Construct, id: string, props: RootStackProps) {
    super(scope, id, props);
    this.templateOptions.description = "(SO8034) - Intelli-Agent";

    const sharedConstruct = new SharedConstruct(this, "shared-construct", {
      config: props.config,
    });

    let knowledgeBaseStack: KnowledgeBaseStack = {} as KnowledgeBaseStack;
    let knowledgeBaseStackOutputs: KnowledgeBaseStackOutputs = {} as KnowledgeBaseStackOutputs;
    const isChinaRegion = props.env?.region.startsWith('cn-');

    const modelConstruct = new ModelConstruct(this, "model-construct", {
      config: props.config,
      sharedConstructOutputs: sharedConstruct,
    });
    modelConstruct.node.addDependency(sharedConstruct);

    knowledgeBaseStack = new KnowledgeBaseStack(this, "kb-construct", {
      config: props.config,
      sharedConstructOutputs: sharedConstruct,
      modelConstructOutputs: modelConstruct,
    });
    knowledgeBaseStack.node.addDependency(sharedConstruct);
    knowledgeBaseStack.node.addDependency(modelConstruct);
    knowledgeBaseStackOutputs = knowledgeBaseStack;

    this.sharedConstruct = sharedConstruct;
    this.modelConstruct = modelConstruct;
    this.config = props.config;

    // new CfnOutput(this, "API Endpoint Address", {
    //   value: apiConstruct.apiEndpoint,
    // });
  }
}


const config = getConfig();

// For development, use account/region from CDK CLI
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1",
};

const app = new App();
let stackName = "craft"
if(config.prefix && config.prefix.trim().length > 0){
  stackName = `${config.prefix}-craft`;
}

new RootStack(app, stackName, {
  config,
  env: devEnv, 
  suppressTemplateIndentation: true,
});

app.synth();
