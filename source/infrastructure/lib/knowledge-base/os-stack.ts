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

import { RemovalPolicy, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Domain, EngineVersion } from "aws-cdk-lib/aws-opensearchservice";
import { Construct } from "constructs";
import { SystemConfig } from "../shared/types";
import { SharedConstructOutputs } from "../shared/shared-construct";

interface AOSProps extends StackProps {
  readonly config: SystemConfig;
  readonly sharedConstructOutputs: SharedConstructOutputs
}

export class AOSConstruct extends Construct {
  public domainEndpoint;

  constructor(scope: Construct, id: string, props: AOSProps) {
    super(scope, id);

    const useIntelliAgentKb = props.config.knowledgeBase.knowledgeBaseType.intelliAgentKb.enabled;
    const useCustomDomain = props.config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.useCustomDomain;

    if (!useIntelliAgentKb) {
      throw new Error("IntelliAgentKb is not enabled");
    }

    if (useCustomDomain) {
      const customDomainEndpoint = props.config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.customDomainEndpoint;
      const devDomain = Domain.fromDomainEndpoint(this, "Domain", customDomainEndpoint);
      this.domainEndpoint = devDomain.domainEndpoint;
      return;
    } else {
      const devDomain = new Domain(this, "Domain", {
        version: EngineVersion.OPENSEARCH_2_17,
        removalPolicy: RemovalPolicy.DESTROY,
        vpc: props.sharedConstructOutputs.vpc,
        securityGroups: props.sharedConstructOutputs.securityGroups,
        capacity: {
          dataNodes: 2,
          dataNodeInstanceType: "r6g.2xlarge.search",
        },
        ebs: {
          volumeSize: 300,
          volumeType: ec2.EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        },
      });

      devDomain.addAccessPolicies(
        new iam.PolicyStatement({
          actions: ["es:*"],
          effect: iam.Effect.ALLOW,
          principals: [new iam.AnyPrincipal()],
          resources: [`${devDomain.domainArn}/*`],
        }),
      );

      this.domainEndpoint = devDomain.domainEndpoint;
    }
  }
}
