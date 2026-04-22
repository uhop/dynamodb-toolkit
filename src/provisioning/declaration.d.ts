import type {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {DynamoDBClient} from '@aws-sdk/client-dynamodb';

/**
 * Normalized declaration consumed by {@link ensureTable} / {@link verifyTable}.
 * Shape mirrors the public Adapter fields so an Adapter instance can be
 * passed directly.
 */
export interface ProvisioningDeclaration {
  client: DynamoDBDocumentClient | DynamoDBClient;
  table: string;
  keyFields: Array<{name: string; type: 'string' | 'number' | 'binary'; width?: number}>;
  structuralKey?: {name: string; separator: string};
  indices?: Record<
    string,
    {
      type: 'gsi' | 'lsi';
      pk?: {name: string; type: 'string' | 'number' | 'binary'};
      sk?: {name: string; type: 'string' | 'number' | 'binary'};
      projection: 'all' | 'keys-only' | string[];
      sparse?: boolean | {onlyWhen: (item: Record<string, unknown>) => boolean};
      indirect?: boolean;
    }
  >;
  typeLabels?: string[];
  typeDiscriminator?: {name: string};
  filterable?: Record<string, string[]>;
  searchable?: Record<string, unknown>;
  searchablePrefix?: string;
  versionField?: string;
  createdAtField?: string;
  technicalPrefix?: string;
  relationships?: {structural?: boolean};
  descriptorKey?: string;
  /** Billing mode override. Defaults to `'PAY_PER_REQUEST'` when absent. */
  billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
  /** Only meaningful when `billingMode === 'PROVISIONED'`. */
  provisionedThroughput?: {ReadCapacityUnits: number; WriteCapacityUnits: number};
  streamSpecification?: {StreamEnabled: boolean; StreamViewType?: string};
}

/** Normalize an Adapter instance or an adapter-shaped declaration. */
export function extractDeclaration(source: unknown): ProvisioningDeclaration;

/** Toolkit key type → DynamoDB AttributeType (`'S'` | `'N'` | `'B'`). */
export function attributeType(t: 'string' | 'number' | 'binary'): 'S' | 'N' | 'B';

/** DynamoDB AttributeType → toolkit key type. */
export function fromAttributeType(a: 'S' | 'N' | 'B'): 'string' | 'number' | 'binary';

/** Toolkit projection → DynamoDB Projection shape. */
export function toProjection(projection: 'all' | 'keys-only' | string[]): {
  ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  NonKeyAttributes?: string[];
};

/** DynamoDB Projection shape → toolkit projection. */
export function fromProjection(p: {ProjectionType?: string; NonKeyAttributes?: string[]}): 'all' | 'keys-only' | string[];

/** Base table KeySchema for CreateTable input. */
export function baseKeySchema(decl: ProvisioningDeclaration): Array<{AttributeName: string; KeyType: 'HASH' | 'RANGE'}>;

/** Union of base + every declared index's AttributeDefinitions. */
export function attributeDefinitions(decl: ProvisioningDeclaration): Array<{AttributeName: string; AttributeType: 'S' | 'N' | 'B'}>;

/** Index KeySchema for CreateTable / UpdateTable. */
export function indexKeySchema(
  decl: ProvisioningDeclaration,
  idx: NonNullable<ProvisioningDeclaration['indices']>[string]
): Array<{AttributeName: string; KeyType: 'HASH' | 'RANGE'}>;

/** Partition the declared indices into GSI / LSI lists. */
export function splitIndices(decl: ProvisioningDeclaration): {
  gsi: Array<{name: string; idx: NonNullable<ProvisioningDeclaration['indices']>[string]}>;
  lsi: Array<{name: string; idx: NonNullable<ProvisioningDeclaration['indices']>[string]}>;
};
