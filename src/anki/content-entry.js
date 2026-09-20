'use strict';

const { installContentFacade } = require('./content-adapter');

installContentFacade({ browserApi: chrome });
