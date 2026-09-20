'use strict';

const { ContractError } = require('./contracts');

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => {};
  });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function storageError(error) {
  if (error instanceof ContractError) {
    return error;
  }
  return new ContractError('STORAGE_FAILED', 'Anki capture storage failed.', {
    retryable: error?.name === 'QuotaExceededError' || error?.name === 'UnknownError',
    details: { name: error?.name || 'Error' },
  });
}

module.exports = {
  clone,
  requestResult,
  storageError,
  transactionDone,
};
