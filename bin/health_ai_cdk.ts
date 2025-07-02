#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { HealthAiCdkStack } from "../lib/health_ai_cdk-stack";

const app = new cdk.App();
new HealthAiCdkStack(app, "HealthAiCdkStack", {});
