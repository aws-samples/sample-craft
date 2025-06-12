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

import { Code, DockerImageCode, DockerImageFunction, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { Duration, IgnoreMode, Size } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import * as path from 'path';
import { IAMHelper } from "../shared/iam-helper";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";


export interface DocConverterProps {
  api: apigw.RestApi;
  auth: apigw.RequestAuthorizer;
  iamHelper: IAMHelper;
  genMethodOption: any;
}

export class DocConverter extends Construct {
  private readonly api: apigw.RestApi;
  private readonly auth: apigw.RequestAuthorizer;
  private readonly iamHelper: IAMHelper;
  private readonly genMethodOption: any;

  constructor(scope: Construct, id: string, props: DocConverterProps) {
    super(scope, id);
    
    this.api = props.api;
    this.auth = props.auth;
    this.iamHelper = props.iamHelper;
    this.genMethodOption = props.genMethodOption;

    const docConverterLambda = new DockerImageFunction(this, 'DocConverterFunction', {
      code: DockerImageCode.fromImageAsset(path.join(__dirname, '../../../lambda/doc-converter'),
      {
        platform: Platform.LINUX_AMD64,
        ignoreMode: IgnoreMode.DOCKER,
      }
    ),
      memorySize: 2048,
      ephemeralStorageSize: Size.mebibytes(2056),
      timeout: Duration.minutes(15),
    });

    // Add S3 permissions
    docConverterLambda.addToRolePolicy(this.iamHelper.s3Statement);

    const apiResourceChores = this.api.root.addResource("converter");
    const apiResourceWordPreview = apiResourceChores.addResource("word-2-pdf");
    apiResourceWordPreview.addMethod("POST", new apigw.LambdaIntegration(docConverterLambda), this.genMethodOption(this.api, this.auth, null),);
  }
}
