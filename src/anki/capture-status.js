'use strict';

function deriveCaptureStatus(capture) {
  if (!capture.active) return 'excluded';
  if (['conflict', 'remote_missing', 'blocked'].includes(capture.link?.deliveryState)) {
    return capture.link.deliveryState;
  }
  if (capture.contentState === 'failed') return 'content_failed';
  if (capture.contentState !== 'ready') return 'waiting_content';
  if (!capture.destination) return 'waiting_setup';
  if (capture.link?.deliveryState === 'synced' && (capture.dirtyFields || []).length === 0) return 'synced';
  return 'waiting_anki';
}

module.exports = { deriveCaptureStatus };
