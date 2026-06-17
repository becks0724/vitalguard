"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IotStack = void 0;
// IoT Stack (dev) — D0 골격. D1 에서 IoT Rule + Lambda 트리거 추가, D2 에서 DDB 쿼리 IAM 추가.
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const iot = __importStar(require("aws-cdk-lib/aws-iot"));
class IotStack extends cdk.Stack {
    vitalTable;
    thing;
    constructor(scope, id, props) {
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
exports.IotStack = IotStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW90LXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW90LXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGdGQUFnRjtBQUNoRixpREFBbUM7QUFDbkMsbUVBQXFEO0FBQ3JELHlEQUEyQztBQUczQyxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyQixVQUFVLENBQWlCO0lBQzNCLEtBQUssQ0FBZTtJQUVwQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUM3RCxTQUFTLEVBQUUsZ0NBQWdDO1lBQzNDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ3ZFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQzVELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxnQ0FBZ0MsRUFBRTtnQkFDaEMsMEJBQTBCLEVBQUUsS0FBSzthQUNsQztTQUNGLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUNyRCxTQUFTLEVBQUUsOEJBQThCO1NBQzFDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUztZQUNoQyxXQUFXLEVBQUUsdUJBQXVCO1NBQ3JDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsSUFBSSxFQUFFO1lBQ2pDLFdBQVcsRUFBRSxxQkFBcUI7U0FDbkMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBaENELDRCQWdDQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIElvVCBTdGFjayAoZGV2KSDigJQgRDAg6rOo6rKpLiBEMSDsl5DshJwgSW9UIFJ1bGUgKyBMYW1iZGEg7Yq466as6rGwIOy2lOqwgCwgRDIg7JeQ7IScIEREQiDsv7zrpqwgSUFNIOy2lOqwgC5cbmltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCAqIGFzIGlvdCBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlvdFwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcblxuZXhwb3J0IGNsYXNzIElvdFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHZpdGFsVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgdGhpbmc6IGlvdC5DZm5UaGluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICB0aGlzLnZpdGFsVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJWaXRhbFN0cmVhbVRhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogXCJzYWZldHltb25pdG9yLXZpdGFsLXN0cmVhbS1kZXZcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcIndvcmtlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwidHNcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeVNwZWNpZmljYXRpb246IHtcbiAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeUVuYWJsZWQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMudGhpbmcgPSBuZXcgaW90LkNmblRoaW5nKHRoaXMsIFwiRGVtb1dvcmtlclRoaW5nXCIsIHtcbiAgICAgIHRoaW5nTmFtZTogXCJzYWZldHltb25pdG9yLWRlbW8td29ya2VyLTAxXCIsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlZpdGFsVGFibGVOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZpdGFsVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246IFwiRHluYW1vREIg7YWM7J2067iUICjsg53ssrQg7Iuc6rOE7Je0KVwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEZW1vVGhpbmdOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnRoaW5nLnRoaW5nTmFtZSA/PyBcIlwiLFxuICAgICAgZGVzY3JpcHRpb246IFwi642w66qoIOyekeyXheyekCBJb1QgVGhpbmcg7J2066aEXCIsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==