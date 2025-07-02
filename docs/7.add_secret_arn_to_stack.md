# Add Secret ARN to Stack

Navigate to your application stack inside the `lib` folder, replace the
`connectionString` with the the host link you copied from the previous workshop
and also replace the `credentialsSecretArn` with `secret arn` you copied in the
previous workshop.

```ts
const pinecone_vectorstore = new PineconeVectorStore({
  connectionString: "https://rag-with-bedrock-xxxxxxxx",
  credentialsSecretArn: "arn:aws:secretsmanager:us-east-1:xxxxxxxxxP",
  textField: "text",
  metadataField: "metadata",
  namespace: "health-ai-app-namespace",
});
```
