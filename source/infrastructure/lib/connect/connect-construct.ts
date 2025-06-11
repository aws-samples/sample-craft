import { Duration, NestedStack } from "aws-cdk-lib";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export interface ConnectConstructProps {
  ecsTriggererLambda: lambda.Function;
}

export class ConnectConstruct extends NestedStack {
  constructor(scope: Construct, id: string, props: ConnectConstructProps) {
    super(scope, id);

    const dlq = new Queue(this, "ConnectDLQ", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.hours(10),
    });

    const messageQueue = new Queue(this, "ConnectMessageQueue", {
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.hours(3),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 50,
      },
    });

    const connectRule = new Rule(
      this,
      "CaseRule",
      {
        eventPattern: {
          source: ["aws.cases"],
          detail: {
            eventType: [
              "RELATED_ITEM.CREATED",
            ],
          },
        },
      }
    );

    connectRule.addTarget(new SqsQueue(messageQueue));

    // Add SQS trigger to lambda
    props.ecsTriggererLambda.addEventSource(
      new SqsEventSource(messageQueue, { batchSize: 10 })
    );
  }
}
