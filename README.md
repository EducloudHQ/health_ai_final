# Welcome to Health AI Assistant

## Content Filters

Security is paramount when building AI applications. With image content filters
in Amazon Bedrock Guardrails, content filters can now detect and filter both
text and image content through six protection categories: Hate, Insults, Sexual,
Violence, Misconduct, and Prompt Attacks.

- In the Configure content filters section, for maximum protection, especially
  in sensitive sectors like healthcare in our example use case, set your
  confidence thresholds to High across all categories for both text and image
  content.
- Enable prompt attack protection to prevent system instruction tampering, and
  use input tagging to maintain accurate classification of system prompts, then
  choose Next.

## Denied topics

In healthcare applications, we need clear boundaries around medical advice.
Let’s configure Amazon Bedrock Guardrails to prevent users from attempting
disease diagnosis, which should be handled by qualified healthcare
professionals.

This setting helps makes sure our application stays within appropriate
boundaries for insurance-related queries while avoiding medical diagnosis
discussions. For example, when users ask questions like “Do I have diabetes?” or
“What’s causing my headache?”, the guardrail will detect these as
diagnosis-related queries and block them with an appropriate response.

## Word Filters

- Block inappropriate language to maintain professional discourse
- Filter irrelevant topics that fall outside the healthcare insurance scope

## ADD PII(Personal Identifiable Information)

Name,email,age,address,phone

## Add Contextual Grounding

Prevent hallucinations and off topic conversations
