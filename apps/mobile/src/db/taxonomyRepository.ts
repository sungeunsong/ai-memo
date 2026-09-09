import { SQLiteDatabase } from 'expo-sqlite';

import {
  DefinitionStatus,
  DomainDefinition,
  FactCardinality,
  FactDefinition,
  FactValueType,
  GlobalRole,
  NormalizationPolicy,
} from '@/features/taxonomy/types';

type DomainRow = {
  key: string;
  label: string;
  status: string;
  use_count: number;
  created_at: string;
  updated_at: string;
};

type FactRow = {
  domain_key: string;
  key: string;
  label: string;
  value_type: string;
  cardinality: string;
  normalization_policy: string;
  global_role: string | null;
  status: string;
  use_count: number;
  created_at: string;
  updated_at: string;
};

export async function listDomainDefinitionsAsync(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<DomainRow>(
    `SELECT key, label, status, use_count, created_at, updated_at
     FROM domain_definitions ORDER BY use_count DESC, key ASC`
  );
  return rows.map(mapDomainRow);
}

export async function listFactDefinitionsAsync(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<FactRow>(
    `SELECT domain_key, key, label, value_type, cardinality, normalization_policy,
            global_role, status, use_count, created_at, updated_at
     FROM fact_definitions ORDER BY domain_key ASC, use_count DESC, key ASC`
  );
  return rows.map(mapFactRow);
}

/**
 * 정의를 넣되 이미 있으면 건드리지 않습니다.
 *
 * 사전은 한 번 정해지면 그것이 기준입니다. 나중에 들어온 값이 기존 정의를
 * 덮으면, 어제 확정한 규칙이 오늘 글 하나 때문에 바뀝니다. 이름이나 정책을
 * 고치는 것은 사용자가 직접 할 일이지 자동으로 일어날 일이 아닙니다.
 */
export async function insertDomainDefinitionIfAbsentAsync(
  db: SQLiteDatabase,
  definition: DomainDefinition
) {
  await db.runAsync(
    `INSERT INTO domain_definitions (key, label, status, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO NOTHING`,
    definition.key,
    definition.label,
    definition.status,
    definition.useCount,
    definition.createdAt,
    definition.updatedAt
  );
}

export async function insertFactDefinitionIfAbsentAsync(
  db: SQLiteDatabase,
  definition: FactDefinition
) {
  await db.runAsync(
    `INSERT INTO fact_definitions (
       domain_key, key, label, value_type, cardinality, normalization_policy,
       global_role, status, use_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain_key, key) DO NOTHING`,
    definition.domainKey,
    definition.key,
    definition.label,
    definition.valueType,
    definition.cardinality,
    definition.normalizationPolicy,
    definition.globalRole,
    definition.status,
    definition.useCount,
    definition.createdAt,
    definition.updatedAt
  );
}

/**
 * 앱이 심는 기본 정의를 넣거나 갱신합니다.
 *
 * 위의 '건드리지 않는다'는 규칙은 AI가 만든 정의에 대한 것입니다. seed는 앱이
 * 소유한 값이라 앱이 고치면 반영되어야 합니다. 실제로 몇 개 항목의 검색 축을
 * 잘못 잡아 고쳤는데, 넣지 않고 건너뛰면 이미 앱을 쓰던 기기만 옛 규칙으로 남습니다.
 *
 * 다만 분야의 이름은 이제 사용자가 고칠 수 있는 값이라 여기서 덮지 않습니다.
 * 심기는 앱이 뜰 때마다 도는데, 덮으면 사용자가 '육아'를 다른 이름으로 바꿔둬도
 * 다음 실행에서 원래대로 돌아갑니다. 앱이 소유한 것은 이름이 아니라 규칙입니다.
 *
 * 쓰인 횟수와 만든 시각도 그대로 둡니다. 사용 이력은 사전이 아니라 사용자의 것입니다.
 */
export async function upsertSeedDomainDefinitionAsync(
  db: SQLiteDatabase,
  definition: DomainDefinition
) {
  await db.runAsync(
    `INSERT INTO domain_definitions (key, label, status, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at`,
    definition.key,
    definition.label,
    definition.status,
    definition.useCount,
    definition.createdAt,
    definition.updatedAt
  );
}

export async function upsertSeedFactDefinitionAsync(
  db: SQLiteDatabase,
  definition: FactDefinition
) {
  await db.runAsync(
    `INSERT INTO fact_definitions (
       domain_key, key, label, value_type, cardinality, normalization_policy,
       global_role, status, use_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain_key, key) DO UPDATE SET
       label = excluded.label,
       value_type = excluded.value_type,
       cardinality = excluded.cardinality,
       normalization_policy = excluded.normalization_policy,
       global_role = excluded.global_role,
       status = excluded.status,
       updated_at = excluded.updated_at`,
    definition.domainKey,
    definition.key,
    definition.label,
    definition.valueType,
    definition.cardinality,
    definition.normalizationPolicy,
    definition.globalRole,
    definition.status,
    definition.useCount,
    definition.createdAt,
    definition.updatedAt
  );
}

/**
 * 쓰인 횟수를 올리고, 임계치를 넘으면 확정으로 승격합니다.
 *
 * 강등은 없습니다. 잘못 만들어진 정의는 자동으로 되돌리는 것보다 사용자가
 * 이름을 고치거나 합치는 편이 안전합니다.
 */
export async function bumpFactDefinitionUseAsync(
  db: SQLiteDatabase,
  domainKey: string,
  key: string,
  confirmThreshold: number,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE fact_definitions
     SET use_count = use_count + 1,
         status = CASE WHEN use_count + 1 >= ? THEN 'confirmed' ELSE status END,
         updated_at = ?
     WHERE domain_key = ? AND key = ?`,
    confirmThreshold,
    updatedAt,
    domainKey,
    key
  );
}

export async function bumpDomainDefinitionUseAsync(
  db: SQLiteDatabase,
  key: string,
  confirmThreshold: number,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE domain_definitions
     SET use_count = use_count + 1,
         status = CASE WHEN use_count + 1 >= ? THEN 'confirmed' ELSE status END,
         updated_at = ?
     WHERE key = ?`,
    confirmThreshold,
    updatedAt,
    key
  );
}

function mapDomainRow(row: DomainRow): DomainDefinition {
  return {
    key: row.key,
    label: row.label,
    status: row.status as DefinitionStatus,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFactRow(row: FactRow): FactDefinition {
  return {
    domainKey: row.domain_key,
    key: row.key,
    label: row.label,
    valueType: row.value_type as FactValueType,
    cardinality: row.cardinality as FactCardinality,
    normalizationPolicy: row.normalization_policy as NormalizationPolicy,
    globalRole: (row.global_role as GlobalRole | null) ?? null,
    status: row.status as DefinitionStatus,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 분야의 표시 이름을 바꿉니다.
 *
 * key는 건드리지 않습니다. 아이템과 항목 정의가 전부 key로 물려 있어서,
 * 이름을 바꾸는 일이 저장된 것을 하나도 건드리지 않게 됩니다.
 */
export async function updateDomainDefinitionLabelAsync(
  db: SQLiteDatabase,
  key: string,
  label: string,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE domain_definitions SET label = ?, updated_at = ? WHERE key = ?`,
    label,
    updatedAt,
    key
  );
}

/** 합치기로 새로 계산한 분야 정의를 그대로 씁니다. */
export async function replaceDomainDefinitionAsync(
  db: SQLiteDatabase,
  definition: DomainDefinition
) {
  await db.runAsync(
    `UPDATE domain_definitions
     SET label = ?, status = ?, use_count = ?, created_at = ?, updated_at = ?
     WHERE key = ?`,
    definition.label,
    definition.status,
    definition.useCount,
    definition.createdAt,
    definition.updatedAt,
    definition.key
  );
}

export async function deleteDomainDefinitionAsync(db: SQLiteDatabase, key: string) {
  await db.runAsync(`DELETE FROM domain_definitions WHERE key = ?`, key);
}

export async function deleteFactDefinitionAsync(
  db: SQLiteDatabase,
  domainKey: string,
  key: string
) {
  await db.runAsync(
    `DELETE FROM fact_definitions WHERE domain_key = ? AND key = ?`,
    domainKey,
    key
  );
}

/** 항목 정의를 다른 분야로 옮깁니다. 옮길 자리에 같은 이름이 없을 때만 부릅니다. */
export async function moveFactDefinitionAsync(
  db: SQLiteDatabase,
  fromDomainKey: string,
  key: string,
  intoDomainKey: string,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE fact_definitions
     SET domain_key = ?, updated_at = ?
     WHERE domain_key = ? AND key = ?`,
    intoDomainKey,
    updatedAt,
    fromDomainKey,
    key
  );
}
