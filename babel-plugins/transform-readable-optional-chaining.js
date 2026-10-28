'use strict';

module.exports = function transformReadableOptionalChaining({ types: t }) {
    function clone(node) {
        return t.cloneNode(node, true);
    }

    /**
     * Returns true when a parameter default can be removed without
     * adding an initialization statement.
     *
     * Examples:
     *
     *     attemptId = null
     *     value = undefined
     */
    function isRemovableParameterDefault(node) {
        return (
            t.isNullLiteral(node) ||
            (
                t.isIdentifier(node) &&
                node.name === 'undefined'
            )
        );
    }

    /**
     * Converts function default parameters into readable initialization
     * statements suitable for SFCC server-side code.
     *
     * Example:
     *
     *     function getService(service, reqMethod = 'POST') {
     *
     * becomes:
     *
     *     function getService(service, reqMethod) {
     *         if (!reqMethod) {
     *             reqMethod = 'POST';
     *         }
     *
     * Example:
     *
     *     function submitData(requestObject, attemptId = null) {
     *
     * becomes:
     *
     *     function submitData(requestObject, attemptId) {
     */
    function transformDefaultParameters(path) {
        const initializationStatements = [];
        let changed = false;

        path.node.params = path.node.params.map((parameter) => {
            if (!t.isAssignmentPattern(parameter)) {
                return parameter;
            }

            if (!t.isIdentifier(parameter.left)) {
                throw path.buildCodeFrameError(
                    'Default parameters using destructuring are not ' +
                    'supported by the readable parameter transform.'
                );
            }

            changed = true;

            const identifier = clone(parameter.left);
            const defaultValue = clone(parameter.right);

            if (!isRemovableParameterDefault(defaultValue)) {
                initializationStatements.push(
                    t.ifStatement(
                        t.unaryExpression(
                            '!',
                            clone(identifier)
                        ),
                        t.blockStatement([
                            t.expressionStatement(
                                t.assignmentExpression(
                                    '=',
                                    clone(identifier),
                                    defaultValue
                                )
                            )
                        ])
                    )
                );
            }

            return identifier;
        });

        if (!changed || initializationStatements.length === 0) {
            return;
        }

        /*
         * A concise arrow function has an expression body, so convert it
         * into a block before inserting the initialization statements.
         *
         * Example:
         *
         *     (value = 'default') => value
         *
         * becomes:
         *
         *     (value) => {
         *         if (!value) {
         *             value = 'default';
         *         }
         *
         *         return value;
         *     }
         */
        if (
            path.isArrowFunctionExpression() &&
            !t.isBlockStatement(path.node.body)
        ) {
            path.node.body = t.blockStatement([
                ...initializationStatements,
                t.returnStatement(
                    clone(path.node.body)
                )
            ]);

            return;
        }

        if (!t.isBlockStatement(path.node.body)) {
            throw path.buildCodeFrameError(
                'Cannot insert readable default-parameter logic into ' +
                'a function without a block body.'
            );
        }

        path.node.body.body.unshift(
            ...initializationStatements
        );
    }

    /**
     * Returns true when a default value does not need an explicit
     * assignment in the generated SFCC code.
     */
    function isRemovableDefault(node) {
        return (
            t.isNullLiteral(node) ||
            (
                t.isIdentifier(node) &&
                node.name === 'undefined'
            )
        );
    }

    /**
     * Builds a member expression for one property in an object pattern.
     */
    function buildPropertyAccess(source, property) {
        return t.memberExpression(
            clone(source),
            clone(property.key),
            property.computed
        );
    }

    /**
     * Recursively converts an object pattern into ordinary property
     * assignments.
     *
     * Example:
     *
     *     {
     *         response: {
     *             resultCode
     *         }
     *     }
     *
     * becomes:
     *
     *     var resultCode = source.response.resultCode;
     */
    function collectObjectPatternDeclarations(
        path,
        pattern,
        source,
        declarations,
        defaultStatements
    ) {
        pattern.properties.forEach((property) => {
            if (t.isRestElement(property)) {
                throw path.buildCodeFrameError(
                    'Object rest properties must be transformed before ' +
                    'the readable destructuring transform.'
                );
            }

            if (!t.isObjectProperty(property)) {
                throw path.buildCodeFrameError(
                    'Unsupported object destructuring property.'
                );
            }

            const propertyAccess = buildPropertyAccess(
                source,
                property
            );

            if (t.isObjectPattern(property.value)) {
                collectObjectPatternDeclarations(
                    path,
                    property.value,
                    propertyAccess,
                    declarations,
                    defaultStatements
                );

                return;
            }

            if (t.isAssignmentPattern(property.value)) {
                const identifier = property.value.left;
                const defaultValue = property.value.right;

                if (!t.isIdentifier(identifier)) {
                    throw path.buildCodeFrameError(
                        'Only identifier defaults are supported by the ' +
                        'readable destructuring transform.'
                    );
                }

                declarations.push(
                    t.variableDeclarator(
                        clone(identifier),
                        propertyAccess
                    )
                );

                if (!isRemovableDefault(defaultValue)) {
                    defaultStatements.push(
                        t.ifStatement(
                            t.unaryExpression(
                                '!',
                                clone(identifier)
                            ),
                            t.blockStatement([
                                t.expressionStatement(
                                    t.assignmentExpression(
                                        '=',
                                        clone(identifier),
                                        clone(defaultValue)
                                    )
                                )
                            ])
                        )
                    );
                }

                return;
            }

            if (!t.isIdentifier(property.value)) {
                throw path.buildCodeFrameError(
                    'Unsupported nested destructuring value.'
                );
            }

            declarations.push(
                t.variableDeclarator(
                    clone(property.value),
                    propertyAccess
                )
            );
        });
    }

    /**
     * Converts object-destructuring variable declarations into readable
     * direct property assignments.
     */
    function transformObjectDestructuring(path) {
        const declarations = [];
        const defaultStatements = [];
        let changed = false;

        path.node.declarations.forEach((declaration) => {
            if (!t.isObjectPattern(declaration.id)) {
                declarations.push(
                    clone(declaration)
                );

                return;
            }

            if (!declaration.init) {
                declarations.push(
                    clone(declaration)
                );

                return;
            }

            changed = true;

            collectObjectPatternDeclarations(
                path,
                declaration.id,
                declaration.init,
                declarations,
                defaultStatements
            );
        });

        if (!changed) {
            return;
        }

        const replacement = [];

        if (declarations.length) {
            replacement.push(
                t.variableDeclaration(
                    path.node.kind,
                    declarations
                )
            );
        }

        replacement.push(...defaultStatements);

        path.replaceWithMultiple(replacement);
    }

    function removeAdyenHeader(comments) {
        if (!comments) {
            return comments;
        }

        return comments.filter((comment) => {
            const value = comment.value;

            const isAdyenHeader =
                value.includes('Adyen Salesforce Commerce Cloud') &&
                value.includes('Copyright') &&
                value.includes('LICENSE');

            return !isAdyenHeader;
        });
    }

    function removeAdyenHeaders(path) {
        if (path.node.comments) {
            path.node.comments = removeAdyenHeader(
                path.node.comments
            );
        }

        path.traverse({
            enter(childPath) {
                if (childPath.node.leadingComments) {
                    childPath.node.leadingComments = removeAdyenHeader(
                        childPath.node.leadingComments
                    );
                }

                if (childPath.node.innerComments) {
                    childPath.node.innerComments = removeAdyenHeader(
                        childPath.node.innerComments
                    );
                }

                if (childPath.node.trailingComments) {
                    childPath.node.trailingComments = removeAdyenHeader(
                        childPath.node.trailingComments
                    );
                }
            }
        });
    }

    /**
     * Determines whether the parent continues the current member or
     * function-call chain.
     *
     * For example:
     *
     *     currentBasket?.getTotalGrossPrice().isAvailable()
     *
     * must be transformed as one complete expression.
     */
    function parentContinuesChain(path) {
        const parent = path.parentPath;

        if (!parent) {
            return false;
        }

        if (
            (
                parent.isOptionalMemberExpression() ||
                parent.isMemberExpression()
            ) &&
            parent.node.object === path.node
        ) {
            return true;
        }

        if (
            (
                parent.isOptionalCallExpression() ||
                parent.isCallExpression()
            ) &&
            parent.node.callee === path.node
        ) {
            return true;
        }

        return false;
    }

    /**
     * Finds the outermost member or call expression belonging to the
     * optional chain.
     */
    function getOutermostChainPath(path) {
        let current = path;

        while (parentContinuesChain(current)) {
            current = current.parentPath;
        }

        return current;
    }

        /**
     * Determines whether the optional-chain base is already checked by
     * an enclosing if statement.
     *
     * This supports nested blocks and callback functions, for example:
     *
     *     if (items) {
     *         Transaction.wrap(() => {
     *             items?.forEach(callback);
     *         });
     *     }
     */
    function isGuardedByEnclosingIf(path, base) {
        let currentPath = path;

        while (currentPath.parentPath) {
            const parentPath = currentPath.parentPath;

            if (
                parentPath.isIfStatement() &&
                parentPath.node.consequent === currentPath.node &&
                t.isNodesEquivalent(
                    parentPath.node.test,
                    base
                )
            ) {
                return true;
            }

            currentPath = parentPath;
        }

        return false;
    }

    /**
     * Flattens a complete member/call chain into:
     *
     * {
     *     base,
     *     operations
     * }
     *
     * Example:
     *
     *     currentBasket?.getTotalGrossPrice().isAvailable()
     *
     * becomes:
     *
     *     base: currentBasket
     *
     *     operations:
     *       optional member getTotalGrossPrice
     *       normal call
     *       normal member isAvailable
     *       normal call
     */
    function flattenChain(node) {
        if (
            t.isOptionalMemberExpression(node) ||
            t.isMemberExpression(node)
        ) {
            const chain = flattenChain(node.object);

            chain.operations.push({
                type: 'member',
                property: clone(node.property),
                computed: Boolean(node.computed),
                optional: Boolean(node.optional)
            });

            return chain;
        }

        if (
            t.isOptionalCallExpression(node) ||
            t.isCallExpression(node)
        ) {
            const chain = flattenChain(node.callee);

            chain.operations.push({
                type: 'call',
                arguments: node.arguments.map(clone),
                optional: Boolean(node.optional)
            });

            return chain;
        }

        return {
            base: clone(node),
            operations: []
        };
    }

    /**
     * Applies one member or call operation to the current expression.
     */
    function applyOperation(current, operation) {
        if (operation.type === 'member') {
            return t.memberExpression(
                clone(current),
                clone(operation.property),
                operation.computed
            );
        }

        if (operation.type === 'call') {
            return t.callExpression(
                clone(current),
                operation.arguments.map(clone)
            );
        }

        throw new Error(
            `Unsupported optional-chain operation: ${operation.type}`
        );
    }

        /**
     * Converts a complete optional chain into an && expression.
     *
     * Example:
     *
     *     paymentInstrument?.paymentTransaction?.amount
     *
     * becomes:
     *
     *     paymentInstrument &&
     *     paymentInstrument.paymentTransaction &&
     *     paymentInstrument.paymentTransaction.amount
     *
     * Example:
     *
     *     currentBasket?.getTotalGrossPrice().isAvailable()
     *
     * becomes:
     *
     *     currentBasket &&
     *     currentBasket.getTotalGrossPrice().isAvailable()
     */
    function buildLogicalChain(path, node) {
        const { base, operations } = flattenChain(node);

        let current = clone(base);
        const expressions = [];

        operations.forEach((operation) => {
            if (operation.optional) {
                expressions.push(clone(current));
            }

            current = applyOperation(
                current,
                operation
            );
        });

        if (expressions.length === 0) {
            return current;
        }

        if (
            expressions.length === 1 &&
            isGuardedByEnclosingIf(path, base)
        ) {
            return current;
        }

        expressions.push(current);

        return expressions.reduce((result, expression) => {
            if (!result) {
                return clone(expression);
            }

            return t.logicalExpression(
                '&&',
                result,
                clone(expression)
            );
        }, null);
    }

      /**
     * Replaces the complete chain containing the supplied optional node.
     */
    function transformChain(path) {
        const outermostPath = getOutermostChainPath(path);
        const replacement = buildLogicalChain(
            outermostPath,
            outermostPath.node
        );

        t.inheritsComments(
            replacement,
            outermostPath.node
        );

        outermostPath.replaceWith(replacement);

    }

    /**
     * Changes concise arrow functions returning ternaries into an
     * explicit block and return statement.
     *
     * Example:
     *
     *     const getAmount = () =>
     *         condition ? first : second;
     *
     * becomes:
     *
     *     const getAmount = () => {
     *         return condition ? first : second;
     *     };
     */
    function addBlockToConditionalArrow(path) {
        if (t.isBlockStatement(path.node.body)) {
            return;
        }

        if (!t.isConditionalExpression(path.node.body)) {
            return;
        }

        path.node.body = t.blockStatement([
            t.returnStatement(
                clone(path.node.body)
            )
        ]);
    }

    return {
        name: 'transform-readable-optional-chaining',

        manipulateOptions(_options, parserOpts) {
            parserOpts.plugins = parserOpts.plugins || [];

            if (!parserOpts.plugins.includes('optionalChaining')) {
                parserOpts.plugins.push('optionalChaining');
            }
        },

        visitor: {
            Program: {
                enter(path) {
                    removeAdyenHeaders(path);
                }
            },

            OptionalMemberExpression: {
                enter(path) {
                    transformChain(path);
                }
            },

            OptionalCallExpression: {
                enter(path) {
                    transformChain(path);
                }
            },

            ArrowFunctionExpression: {
                exit(path) {
                    addBlockToConditionalArrow(path);
                }
            },

            VariableDeclaration: {
                exit(path) {
                    transformObjectDestructuring(path);
                }
            },

            Function: {
                enter(path) {
                    transformDefaultParameters(path);
                }
            }
        }
    };
};