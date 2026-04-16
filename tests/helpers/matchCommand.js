// SDK mock helper — matches DynamoDBDocumentClient.send() calls by command class name and input shape.

export function matchCommand(handlers) {
  return async function mockSend(command) {
    const name = command.constructor.name;
    const handler = handlers[name];
    if (!handler) throw new Error(`Unexpected command: ${name}`);
    return handler(command.input, command);
  };
}
