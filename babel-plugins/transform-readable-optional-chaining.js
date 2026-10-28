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
     * Flatten:
     *
     *     paymentInstrument?.paymentTransaction?.amount
     *
     * into:
     *
     *     base: paymentInstrument
     *
     *     members:
     *       paymentTransaction
     *       amount
     */
    function flattenChain(node) {
        const members = [];
        let current = node;

        while (
            t.isOptionalMemberExpression(current) ||
            t.isMemberExpression(current)
        ) {
            members.unshift({
                property: clone(current.property),
                computed: current.computed,
                optional: Boolean(current.optional)
            });

            current = current.object;
        }

        return {
            base: clone(current),
            members
        };
    }

    /**
     * Converts:
     *
     *     foo?.bar?.baz
     *
     * into:
     *
     *     foo && foo.bar && foo.bar.baz
     */
    function buildMemberChain(node) {
        const { base, members } = flattenChain(node);

        let current = clone(base);
        let result = null;

        members.forEach((member) => {
            if (member.optional) {
                result = result
                    ? t.logicalExpression(
                        '&&',
                        result,
                        clone(current)
                    )
                    : clone(current);
            }

            current = t.memberExpression(
                clone(current),
                clone(member.property),
                member.computed
            );
        });

        if (!result) {
            return current;
        }

        return t.logicalExpression(
            '&&',
            result,
            current
        );
    }

    function isPartOfLargerChain(path) {
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
            parent.isOptionalCallExpression() &&
            parent.node.callee === path.node
        ) {
            return true;
        }

        return false;
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
            OptionalCallExpression: {
                exit(path) {
                    /*
                     * Handles:
                     *
                     *     foo?.bar()
                     *
                     * but NOT:
                     *
                     *     foo.bar?.()
                     *     foo?.()
                     */
                    if (path.node.optional) {
                        throw path.buildCodeFrameError(
                            'Optional call operator ?.() is not supported.'
                        );
                    }

                    const callee = path.node.callee;

                    if (
                        !t.isOptionalMemberExpression(callee) &&
                        !t.isMemberExpression(callee)
                    ) {
                        return;
                    }

                    const transformedCallee =
                        buildMemberChain(callee);

                    /*
                     * buildMemberChain(foo?.bar) gives:
                     *
                     *     foo && foo.bar
                     *
                     * We need:
                     *
                     *     foo && foo.bar()
                     */
                    if (!t.isLogicalExpression(transformedCallee)) {
                        return;
                    }

                    const replacement = t.logicalExpression(
                        '&&',
                        transformedCallee.left,
                        t.callExpression(
                            transformedCallee.right,
                            path.node.arguments.map(clone)
                        )
                    );

                    path.replaceWith(replacement);
                }
            },

            OptionalMemberExpression: {
                exit(path) {
                    if (isPartOfLargerChain(path)) {
                        return;
                    }

                    path.replaceWith(
                        buildMemberChain(path.node)
                    );
                }
            }
        }
    };
};