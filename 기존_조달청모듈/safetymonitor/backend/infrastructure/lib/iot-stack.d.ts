import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iot from "aws-cdk-lib/aws-iot";
import { Construct } from "constructs";
export declare class IotStack extends cdk.Stack {
    readonly vitalTable: dynamodb.Table;
    readonly thing: iot.CfnThing;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
