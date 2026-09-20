'use strict';

const { ContractError } = require('../../../src/anki/contracts');
const { ANKI_FIELD_NAMES } = require('../../../src/anki/contracts');
const { MODEL_NAME } = require('../../../src/anki/note-model');

function clone(value) {
  return structuredClone(value);
}

class FakeAnki {
  constructor({ deckName = 'LingKuma', modelName = MODEL_NAME, profile = 'User 1' } = {}) {
    this.deckName = deckName;
    this.modelName = modelName;
    this.profile = profile;
    this.notes = new Map();
    this.calls = [];
    this.nextNoteId = 1000;
    this.afterAdd = null;
  }

  async getProfileStatus(expectedProfile) {
    this.calls.push({ action: 'getActiveProfile' });
    if (expectedProfile && expectedProfile !== this.profile) {
      throw new ContractError('PROFILE_MISMATCH', 'profile mismatch');
    }
    return { supported: true, activeProfile: this.profile, matches: expectedProfile ? true : null };
  }

  async deckNames() {
    this.calls.push({ action: 'deckNames' });
    return [this.deckName];
  }

  async modelFieldNames(modelName) {
    this.calls.push({ action: 'modelFieldNames', modelName });
    return modelName === this.modelName ? [...ANKI_FIELD_NAMES] : [];
  }

  async findNotesByCaptureId(captureId) {
    this.calls.push({ action: 'findNotes', captureId });
    return Array.from(this.notes.values())
      .filter(note => note.fields.CaptureId === captureId)
      .map(note => note.noteId);
  }

  async notesInfo(noteIds) {
    this.calls.push({ action: 'notesInfo', noteIds: [...noteIds] });
    return noteIds.flatMap(noteId => {
      const note = this.notes.get(noteId);
      if (!note) {
        return [];
      }
      return [{
        noteId,
        modelName: note.modelName,
        tags: [...note.tags],
        fields: Object.fromEntries(Object.entries(note.fields).map(([name, value], order) => [
          name,
          { value, order },
        ])),
        cards: [noteId + 10_000],
      }];
    });
  }

  async addNote(note) {
    this.calls.push({ action: 'addNote', note: clone(note) });
    const firstField = ANKI_FIELD_NAMES[0];
    if (note.options?.allowDuplicate === false
        && Array.from(this.notes.values()).some(existing => existing.fields[firstField] === note.fields[firstField])) {
      throw new ContractError('ANKI_API_ERROR', 'duplicate', {
        details: { remoteMessage: 'cannot create note because it is a duplicate' },
      });
    }
    const noteId = this.nextNoteId;
    this.nextNoteId += 1;
    this.notes.set(noteId, {
      noteId,
      deckName: note.deckName,
      modelName: note.modelName,
      fields: clone(note.fields),
      tags: [...note.tags],
    });
    if (this.afterAdd) {
      await this.afterAdd({ noteId, note: this.notes.get(noteId) });
    }
    return noteId;
  }

  seedNote(note) {
    const noteId = note.noteId || this.nextNoteId++;
    this.notes.set(noteId, {
      noteId,
      deckName: note.deckName || this.deckName,
      modelName: note.modelName || this.modelName,
      fields: clone(note.fields),
      tags: [...(note.tags || ['lingkuma::lookup'])],
    });
    return noteId;
  }

  countCalls(action) {
    return this.calls.filter(call => call.action === action).length;
  }
}

module.exports = { FakeAnki };
