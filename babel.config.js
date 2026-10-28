const path = require("path");
/* eslint-disable */
module.exports = function (api) {
    api.cache(true);

    return {
        assumptions: {
            noDocumentAll: true
        },
        comments: true,
        compact: false,
        minified: false,
        retainLines: false,

        overrides: [{
            test: /src[\\/]cartridges[\\/]/,
            exclude: [
                /cartridge\/client\//,
                /cartridge\/static\//
            ],

            plugins: [
                [
                    "@babel/plugin-proposal-decorators",
                    {
                        legacy: true
                    }
                ],
                path.resolve(
                    __dirname,
                    'babel-plugins',
                    'transform-readable-optional-chaining.js'
                )
            ]
        }],

        ignore: [
            "**/*.test.js",
            "**/*.test.js.snap",
            "src/cartridges/adyen_controllers_changes/**",
            "src/cartridges/bm_adyen/cartridge/static/**"
        ]
    };
};