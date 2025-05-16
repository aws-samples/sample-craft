import { Duration, NestedStack } from "aws-cdk-lib";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";

export class ConnectConstruct extends NestedStack {
  constructor(scope: Construct, id: string) {
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
    // // TODO: consume the message from ECS Fargate
    // props.lambdaOnlineMain.addEventSource(
    //   new SqsEventSource(messageQueue, { batchSize: 10 }),
    // );
  }
}
