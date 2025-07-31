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

import { Construct } from "constructs";
import * as dotenv from "dotenv";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";

import { SystemConfig } from "./types";
import { IAMHelper } from "./iam-helper";
import { VpcConstruct } from "./vpc-construct";
import { SecurityGroup, IVpc, ISubnet } from 'aws-cdk-lib/aws-ec2';

dotenv.config();

export interface SharedConstructProps {
  readonly config: SystemConfig;
}

export interface SharedConstructOutputs {
  iamHelper: IAMHelper;
  resultBucket: s3.Bucket;
  vpc: IVpc;
  privateSubnets?: ISubnet[];
  securityGroups?: SecurityGroup[];
}

export class SharedConstruct extends Construct implements SharedConstructOutputs {
  public iamHelper: IAMHelper;
  public resultBucket: s3.Bucket;

  public vpc: IVpc;
  public privateSubnets?: ISubnet[];
  public securityGroups?: SecurityGroup[];

  constructor(scope: Construct, id: string, props: SharedConstructProps) {
    super(scope, id);
    console.log(props);
    const iamHelper = new IAMHelper(this, "iam-helper");
    let vpcConstruct;

    vpcConstruct = new VpcConstruct(this, "vpc-construct", {
      config: props.config,
    });

    const resultBucket = new s3.Bucket(this, "craft-result-bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.vpc = vpcConstruct.vpc;
    this.privateSubnets = vpcConstruct.privateSubnets;
    this.securityGroups = vpcConstruct.securityGroups;
    this.iamHelper = iamHelper;
    this.resultBucket = resultBucket;
  }
}
