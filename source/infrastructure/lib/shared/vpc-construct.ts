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

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { SystemConfig } from "./types";
import * as dotenv from "dotenv";

dotenv.config();

export interface VpcConstructProps {
  readonly config: SystemConfig;
}


export class VpcConstruct extends Construct {
  public vpc: ec2.IVpc;
  public securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    // Check if we should create a new VPC or use an existing one
    if (props.config.vpc.createNewVpc) {
      // Create a new VPC
      this.vpc = new ec2.Vpc(this, "LLM-VPC", {
        ipAddresses: ec2.IpAddresses.cidr("10.100.0.0/16"),
        maxAzs: 2,
      });
    } else {
      // Use existing VPC
      if (!props.config.vpc.existingVpcId) {
        throw new Error("existingVpcId is required when createNewVpc is false. Please check your config.json file.");
      }

      this.vpc = ec2.Vpc.fromLookup(this, "LLM-VPC", {
        vpcId: props.config.vpc.existingVpcId,
      });
    }

    // throw error if no private subnets
    if (this.vpc.privateSubnets.length === 0) {
      throw new Error("No private subnets found in the VPC. Please check your VPC configuration.");
    }

    this.securityGroup = new ec2.SecurityGroup(this, "LLM-VPC-SG", {
      vpc: this.vpc,
      description: "LLM Security Group",
    });

    this.securityGroup.addIngressRule(
      this.securityGroup,
      ec2.Port.allTraffic(),
      "allow self traffic",
    );

    this.vpc.addGatewayEndpoint("DynamoDbEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    this.vpc.addInterfaceEndpoint("Glue", {
      service: ec2.InterfaceVpcEndpointAwsService.GLUE,
      securityGroups: [this.securityGroup],
      subnets: { subnets: this.vpc.privateSubnets },
    });

  }
}
