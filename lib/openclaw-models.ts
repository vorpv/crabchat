import { listConfiguredModels } from "@/lib/openclaw-gateway"

export async function listModelOptions() {
  return listConfiguredModels()
}
