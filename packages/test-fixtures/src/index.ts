import {
  defaultTeam,
  type ProjectWork,
  type TeamState,
} from "@circular-city/game-engine";
import { PROJECTS } from "@circular-city/game-content";
export const teamFixture = (id = "team_fixture", slot = 1): TeamState =>
  defaultTeam(id, slot);
export const projectWorkFixture = (): ProjectWork => ({
  municipalityReady: true,
  mrfReady: true,
  brokerReady: true,
  plannedMaterialsKg: PROJECTS[0]!.requirementsKg,
  workRevision: 0,
});
