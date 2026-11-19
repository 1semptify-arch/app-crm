// Shared shape for plugin_data rows — identical across all three backends:
//   LocalStore    → rows in the `crm.pluginData` localStorage key
//   DriveStore    → rows in the `semptify.crm.plugin_data.json` appData file
//   SupabaseStore → rows in the `plugin_data` table
// A settings row is `{ plugin, entity_type: 'setting', entity_id: null,
// data: { key, value } }`, upserted on (plugin, key). Rows belonging to
// other plugins or entity_types pass through untouched.

export interface PluginDataRow {
  plugin?: string;
  entity_type?: string;
  entity_id?: string | null;
  data?: { key?: string; value?: Record<string, unknown> } | null;
  [k: string]: unknown;
}

export function isSettingRow(row: PluginDataRow, plugin: string, key: string): boolean {
  return row.plugin === plugin && row.entity_type === 'setting' && row.data?.key === key;
}

export function settingRow(
  plugin: string,
  key: string,
  value: Record<string, unknown>,
): PluginDataRow {
  return { plugin, entity_type: 'setting', entity_id: null, data: { key, value } };
}
