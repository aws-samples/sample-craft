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
import * as s3 from "aws-cdk-lib/aws-s3";

import { SystemConfig } from "./types";
import { IAMHelper } from "./iam-helper";

dotenv.config();

export interface SharedConstructProps {
  readonly config: SystemConfig;
}

export interface SharedConstructOutputs {
  iamHelper: IAMHelper;
  resultBucket: s3.Bucket;
}

export class SharedConstruct extends Construct implements SharedConstructOutputs {
  public iamHelper: IAMHelper;
  public resultBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SharedConstructProps) {
    super(scope, id);
    console.log(props);
    const iamHelper = new IAMHelper(this, "iam-helper");

    const resultBucket = new s3.Bucket(this, "craft-result-bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.iamHelper = iamHelper;
    this.resultBucket = resultBucket;
  }
}
