#!/usr/bin/env node
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
// CDK 앱 진입점 — IotStack 1개 (dev). Region 은 ap-northeast-2 (서울) 고정.
const cdk = __importStar(require("aws-cdk-lib"));
const iot_stack_1 = require("../lib/iot-stack");
const app = new cdk.App();
new iot_stack_1.IotStack(app, "SafetyMonitor-IotStack-Dev", {
    env: {
        region: "ap-northeast-2",
    },
    description: "SafetyMonitor 프로토타입 IoT 스택 (dev) — Watch → IoT Core → DDB",
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLGtFQUFrRTtBQUNsRSxpREFBbUM7QUFDbkMsZ0RBQTRDO0FBRTVDLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLElBQUksb0JBQVEsQ0FBQyxHQUFHLEVBQUUsNEJBQTRCLEVBQUU7SUFDOUMsR0FBRyxFQUFFO1FBQ0gsTUFBTSxFQUFFLGdCQUFnQjtLQUN6QjtJQUNELFdBQVcsRUFBRSwyREFBMkQ7Q0FDekUsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLy8gQ0RLIOyVsSDsp4TsnoXsoJAg4oCUIElvdFN0YWNrIDHqsJwgKGRldikuIFJlZ2lvbiDsnYAgYXAtbm9ydGhlYXN0LTIgKOyEnOyauCkg6rOg7KCVLlxuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgSW90U3RhY2sgfSBmcm9tIFwiLi4vbGliL2lvdC1zdGFja1wiO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG5uZXcgSW90U3RhY2soYXBwLCBcIlNhZmV0eU1vbml0b3ItSW90U3RhY2stRGV2XCIsIHtcbiAgZW52OiB7XG4gICAgcmVnaW9uOiBcImFwLW5vcnRoZWFzdC0yXCIsXG4gIH0sXG4gIGRlc2NyaXB0aW9uOiBcIlNhZmV0eU1vbml0b3Ig7ZSE66Gc7Yag7YOA7J6FIElvVCDsiqTtg50gKGRldikg4oCUIFdhdGNoIOKGkiBJb1QgQ29yZSDihpIgRERCXCIsXG59KTtcbiJdfQ==