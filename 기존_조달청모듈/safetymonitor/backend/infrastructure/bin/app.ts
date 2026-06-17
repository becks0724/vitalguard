#!/usr/bin/env node
// CDK 앱 진입점 — IotStack 1개 (dev). Region 은 ap-northeast-2 (서울) 고정.
import * as cdk from "aws-cdk-lib";
import { IotStack } from "../lib/iot-stack";

const app = new cdk.App();

new IotStack(app, "SafetyMonitor-IotStack-Dev", {
  env: {
    region: "ap-northeast-2",
  },
  description: "SafetyMonitor 프로토타입 IoT 스택 (dev) — Watch → IoT Core → DDB",
});
