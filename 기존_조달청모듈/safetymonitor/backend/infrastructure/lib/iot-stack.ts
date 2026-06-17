// IoT Stack (dev) — D0 골격. D1 에서 IoT Rule + Lambda 트리거 추가, D2 에서 DDB 쿼리 IAM 추가.
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iot from "aws-cdk-lib/aws-iot";
import { Construct } from "constructs";

export class IotStack extends cdk.Stack {
  public readonly vitalTable: dynamodb.Table;
  public readonly thing: iot.CfnThing;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vitalTable = new dynamodb.Table(this, "VitalStreamTable", {
      tableName: "safetymonitor-vital-stream-dev",
      partitionKey: { name: "workerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "ts", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
    });

    this.thing = new iot.CfnThing(this, "DemoWorkerThing", {
      thingName: "safetymonitor-demo-worker-01",
    });

    new cdk.CfnOutput(this, "VitalTableName", {
      value: this.vitalTable.tableName,
      description: "DynamoDB 테이블 (생체 시계열)",
    });

    new cdk.CfnOutput(this, "DemoThingName", {
      value: this.thing.thingName ?? "",
      description: "데모 작업자 IoT Thing 이름",
    });
  }
}
