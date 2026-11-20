'use strict';

var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');
module.exports = (error, res, data) => {
    if (error instanceof AdyenError) {
        res.json(
            Object.assign({}, data, {
                error: true,
                errorType: 'AdyenError'
            })
        );
    } else {
        res.json(
            Object.assign({}, data, {
                error: true
            })
        );
    }
};
