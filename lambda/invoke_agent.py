import json
import os
import uuid

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.data_classes.appsync import scalar_types_utils 
bedrock_agent_runtime_client = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

logger = Logger(service="invoke_agent_lambda")
tracer = Tracer(service="invoke_agent_lambda")

AGENT_ID    = os.environ["AGENT_ID"]    # fail fast if missing
AGENT_ALIAS = os.environ["AGENT_ALIAS"]


@logger.inject_lambda_context
@tracer.capture_lambda_handler
def handler(event, context):
    """
    AppSync resolver → Bedrock Agent streaming invocation
    """
    try:
        logger.info("Received event: %s", json.dumps(event, indent=2))

      
        args        = event["arguments"]["input"]
        query       = args["query"]
        session_id  = args.get("session_id") or _generate_session_id()

        logger.info("Query: %s", query)
        logger.info("SessionId: %s", session_id)

       
        agent_response = bedrock_agent_runtime_client.invoke_agent(
            inputText      = query,
            agentId        = AGENT_ID,
            agentAliasId   = AGENT_ALIAS,
            sessionId      = session_id,
            enableTrace    = True,
        )

        # Ensure the response contains the event stream
        if "completion" not in agent_response:
            raise Exception("Agent response is missing `completion` field.")

        event_stream = agent_response["completion"]

        # Collect all chunks from the stream
        chunks = []
        for event in event_stream:
            chunk = event.get("chunk")
            if chunk:
                decoded_bytes = chunk.get("bytes").decode()
                print("bytes: ", decoded_bytes)
                chunks.append(decoded_bytes)
        completion = " ".join(chunks)
        logger.info("Completion: %s", completion)

        # ── 4. Return to AppSync ------------------------------------------------------
        return {
            "response"  : completion,
            "session_id": session_id,
        }

    except Exception as exc:  
        logger.exception("Unhandled error")
    
        return {
            "error": str(exc),
            "session_id": event.get("arguments", {}).get("input", {}).get("session_id"),
        }


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _generate_session_id() -> str:
 
    return str(uuid.uuid4())
