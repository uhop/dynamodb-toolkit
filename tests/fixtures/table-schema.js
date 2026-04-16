// CreateTable input for the test table.
// Key: name (string). GSI: -t-name-index (partition key -t, sort key name) for sorted queries.

export const tableSchema = name => ({
  TableName: name,
  BillingMode: 'PAY_PER_REQUEST',
  KeySchema: [{AttributeName: 'name', KeyType: 'HASH'}],
  AttributeDefinitions: [
    {AttributeName: 'name', AttributeType: 'S'},
    {AttributeName: '-t', AttributeType: 'N'}
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: '-t-name-index',
      KeySchema: [
        {AttributeName: '-t', KeyType: 'HASH'},
        {AttributeName: 'name', KeyType: 'RANGE'}
      ],
      Projection: {ProjectionType: 'ALL'}
    }
  ]
});
