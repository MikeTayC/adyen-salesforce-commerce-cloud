'use strict';

module.exports = function transformReadableOptionalChaining({ types: t }) {
    function clone(node) {
        return t.cloneNode(node, true);
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
            }
        }
    };
};