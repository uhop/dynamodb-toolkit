// Internal: send a Query or Scan based on whether KeyConditionExpression is present.

import {QueryCommand, ScanCommand} from '@aws-sdk/lib-dynamodb';

export const sendQueryOrScan = (client, params) => client.send(params.KeyConditionExpression ? new QueryCommand(params) : new ScanCommand(params));
