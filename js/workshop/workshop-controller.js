import {
  clearWorkshopRejectedItems,
  createWorkshopBuild,
  equipWorkshopItem,
  rejectWorkshopItem,
  removeWorkshopItem,
  setWorkshopClass,
  setWorkshopSelectedSpells,
  setWorkshopSlotLocked
} from './workshop-build.js';
import { evaluateWorkshopBuild } from './workshop-evaluator.js';

export class WorkshopController {
  constructor({ dataset, spellData, build = createWorkshopBuild(), evaluate = evaluateWorkshopBuild, onChange = () => {} } = {}) {
    this.dataset = dataset;
    this.spellData = spellData;
    this.evaluate = evaluate;
    this.onChange = onChange;
    this.build = createWorkshopBuild(build);
    this.evaluation = null;
    this.refresh();
  }

  snapshot() {
    return { build: this.build, evaluation: this.evaluation };
  }

  refresh() {
    this.evaluation = this.evaluate({
      build: this.build,
      dataset: this.dataset,
      spellData: this.spellData
    });
    const snapshot = this.snapshot();
    this.onChange(snapshot);
    return snapshot;
  }

  replaceBuild(build = createWorkshopBuild()) {
    this.build = createWorkshopBuild(build);
    return this.refresh();
  }

  setClass(classId) {
    this.build = setWorkshopClass(this.build, classId);
    return this.refresh();
  }

  setSelectedSpells(spellIds) {
    this.build = setWorkshopSelectedSpells(this.build, spellIds);
    return this.refresh();
  }

  setSlotLocked(slotKey, locked = true) {
    this.build = setWorkshopSlotLocked(this.build, slotKey, locked);
    return this.refresh();
  }

  reject(slotKey) {
    this.build = rejectWorkshopItem(this.build, slotKey);
    return this.refresh();
  }

  clearRejected() {
    this.build = clearWorkshopRejectedItems(this.build);
    return this.refresh();
  }

  equip(slotKey, item) {
    const update = equipWorkshopItem(this.build, slotKey, item);
    if (!update.accepted) return { ...update, snapshot: this.snapshot() };
    this.build = update.build;
    return { ...update, snapshot: this.refresh() };
  }

  remove(slotKey) {
    this.build = removeWorkshopItem(this.build, slotKey);
    return this.refresh();
  }
}
