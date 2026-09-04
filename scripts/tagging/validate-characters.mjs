import fs from 'node:fs';

const ITEMS_PATH = new URL('../../data/items.json', import.meta.url);
const CHARACTERS_PATH = new URL('../../data/characters.json', import.meta.url);

const items = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
const data = JSON.parse(fs.readFileSync(CHARACTERS_PATH, 'utf8'));

if (data.schema_version !== 1) throw new Error('Unsupported character schema_version');
if (!Array.isArray(data.characters) || data.characters.length === 0) throw new Error('characters must be a non-empty array');

const itemIds = new Set(items.map(item => item.id));
const characterIds = new Set();
const validCertainty = new Set(['explicit', 'inferred_high', 'inferred_medium']);
const validTier = new Set(['main', 'supporting', 'cameo']);

for (const character of data.characters) {
  if (!character.id || !character.name || !character.name_ja) throw new Error(`Missing identity fields: ${JSON.stringify(character)}`);
  if (typeof character.intro_ja !== 'string' || !character.intro_ja.trim()) throw new Error(`Missing intro_ja for ${character.id}`);
  if (characterIds.has(character.id)) throw new Error(`Duplicate character id: ${character.id}`);
  characterIds.add(character.id);
  if (!validTier.has(character.tier)) throw new Error(`Invalid tier for ${character.id}: ${character.tier}`);
  if (!Array.isArray(character.traits) || !Array.isArray(character.relationships) || !Array.isArray(character.source_item_ids)) {
    throw new Error(`Invalid arrays for ${character.id}`);
  }
  for (const itemId of character.source_item_ids) {
    if (!itemIds.has(itemId)) throw new Error(`Unknown source item ${itemId} in ${character.id}`);
  }
  for (const trait of character.traits) {
    if (!trait.id || !trait.label_ja || !validCertainty.has(trait.certainty) || !Array.isArray(trait.evidence) || trait.evidence.length === 0) {
      throw new Error(`Invalid trait in ${character.id}: ${JSON.stringify(trait)}`);
    }
    for (const itemId of trait.evidence) {
      if (!itemIds.has(itemId)) throw new Error(`Unknown trait evidence ${itemId} in ${character.id}`);
    }
  }
  for (const relationship of character.relationships) {
    if (!relationship.type || !relationship.label_ja || !validCertainty.has(relationship.certainty) || !Array.isArray(relationship.evidence) || relationship.evidence.length === 0) {
      throw new Error(`Invalid relationship in ${character.id}: ${JSON.stringify(relationship)}`);
    }
    for (const itemId of relationship.evidence) {
      if (!itemIds.has(itemId)) throw new Error(`Unknown relationship evidence ${itemId} in ${character.id}`);
    }
  }
}

for (const character of data.characters) {
  for (const relationship of character.relationships) {
    if (relationship.character_id !== null && !characterIds.has(relationship.character_id)) {
      throw new Error(`Unknown relationship target ${relationship.character_id} from ${character.id}`);
    }
  }
}

console.log(`Validated ${data.characters.length} character profiles against ${items.length} example sentences.`);
