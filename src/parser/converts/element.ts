import type {
    Comment,
    SvelteAwaitBlock,
    SvelteAwaitCatchBlock,
    SvelteAwaitPendingBlock,
    SvelteAwaitThenBlock,
    SvelteComponentElement,
    SvelteDebugTag,
    SvelteEachBlock,
    SvelteElement,
    SvelteElseBlock,
    SvelteHtmlElement,
    SvelteIfBlock,
    SvelteKeyBlock,
    SvelteMustacheTag,
    SvelteName,
    SvelteProgram,
    SvelteScriptElement,
    SvelteSpecialDirective,
    SvelteSpecialElement,
    SvelteStyleElement,
    SvelteText,
} from "../../ast"
import type ESTree from "estree"
import type { Context } from "../../context"
import type * as SvAST from "../svelte-ast-types"

import {
    convertAwaitBlock,
    convertEachBlock,
    convertIfBlock,
    convertKeyBlock,
} from "./block"
import { indexOf } from "./common"
import {
    convertMustacheTag,
    convertDebugTag,
    convertRawMustacheTag,
} from "./mustache"
import { convertText } from "./text"
import { analyzeExpressionScope, convertESNode, getWithLoc } from "./es"
import { convertAttributes } from "./attr"

/* eslint-disable complexity -- X */
/** Convert for Fragment or Element or ... */
export function* convertChildren(
    /* eslint-enable complexity -- X */
    fragment: { children: SvAST.TemplateNode[] },
    parent:
        | SvelteProgram
        | SvelteElement
        | SvelteIfBlock
        | SvelteElseBlock
        | SvelteEachBlock
        | SvelteAwaitPendingBlock
        | SvelteAwaitThenBlock
        | SvelteAwaitCatchBlock
        | SvelteKeyBlock,
    ctx: Context,
): IterableIterator<
    | SvelteText
    | SvelteElement
    | SvelteMustacheTag
    | SvelteDebugTag
    | SvelteIfBlock
    | SvelteEachBlock
    | SvelteAwaitBlock
    | SvelteKeyBlock
> {
    for (const child of fragment.children) {
        if (child.type === "Comment") {
            const comment: Comment = {
                type: "Block",
                value: child.data,
                ...ctx.getConvertLocation(child),
            }
            ;(comment as any).html = true
            ctx.addComment(comment)
            continue
        }
        if (child.type === "Text") {
            yield convertText(child, parent, ctx)
            continue
        }
        if (child.type === "Element") {
            yield convertHtmlElement(child, parent, ctx)
            continue
        }
        if (child.type === "InlineComponent") {
            if (child.name.includes(":")) {
                yield convertSpecialElement(child, parent, ctx)
            } else {
                yield convertComponentElement(child, parent, ctx)
            }
            continue
        }
        if (child.type === "Slot") {
            yield convertSlotElement(child, parent, ctx)
            continue
        }
        if (child.type === "MustacheTag") {
            yield convertMustacheTag(child, parent, ctx)
            continue
        }
        if (child.type === "RawMustacheTag") {
            yield convertRawMustacheTag(child, parent, ctx)
            continue
        }
        if (child.type === "IfBlock") {
            // {#if expr} {/if}
            yield convertIfBlock(child, parent, ctx)
            continue
        }
        if (child.type === "EachBlock") {
            // {#each expr as item, index (key)} {/each}
            yield convertEachBlock(child, parent, ctx)
            continue
        }
        if (child.type === "AwaitBlock") {
            // {#await promise} {:then number} {:catch error} {/await}
            yield convertAwaitBlock(child, parent, ctx)
            continue
        }
        if (child.type === "KeyBlock") {
            // {#key expression}...{/key}
            yield convertKeyBlock(child, parent, ctx)
            continue
        }
        if (child.type === "Window") {
            yield convertWindowElement(child, parent, ctx)
            continue
        }
        if (child.type === "Body") {
            yield convertBodyElement(child, parent, ctx)
            continue
        }
        if (child.type === "Head") {
            yield convertHeadElement(child, parent, ctx)
            continue
        }
        if (child.type === "Options") {
            yield convertOptionsElement(child, parent, ctx)
            continue
        }
        if (child.type === "SlotTemplate") {
            yield convertSlotTemplateElement(child, parent, ctx)
            continue
        }
        if (child.type === "DebugTag") {
            yield convertDebugTag(child, parent, ctx)
            continue
        }

        throw new Error(`Unknown type:${(child as any).type}`)
    }
}

/** Convert for HtmlElement */
function convertHtmlElement(
    node: SvAST.Element | SvAST.Slot,
    parent: SvelteHtmlElement["parent"],
    ctx: Context,
): SvelteHtmlElement {
    const element: SvelteHtmlElement = {
        type: "SvelteElement",
        kind: "html",
        name: null as any,
        attributes: [],
        children: [],
        parent,
        ...ctx.getConvertLocation(node),
    }
    element.attributes.push(...convertAttributes(node.attributes, element, ctx))
    element.children.push(...convertChildren(node, element, ctx))

    extractElementTokens(element, ctx, {
        buildNameNode: (openTokenRange) => {
            const name: SvelteName = {
                type: "SvelteName",
                name: node.name,
                parent: element,
                ...ctx.getConvertLocation(openTokenRange),
            }
            return name
        },
    })

    return element
}

/** Convert for Special element. e.g. <svelte:self> */
function convertSpecialElement(
    node:
        | SvAST.InlineComponent
        | SvAST.Window
        | SvAST.Body
        | SvAST.Head
        | SvAST.Options
        | SvAST.SlotTemplate,
    parent: SvelteSpecialElement["parent"],
    ctx: Context,
): SvelteSpecialElement {
    const element: SvelteSpecialElement = {
        type: "SvelteElement",
        kind: "special",
        name: null as any,
        attributes: [],
        children: [],
        parent,
        ...ctx.getConvertLocation(node),
    }
    element.attributes.push(...convertAttributes(node.attributes, element, ctx))
    element.children.push(...convertChildren(node, element, ctx))

    if (
        node.type === "InlineComponent" &&
        node.expression &&
        node.name === "svelte:component"
    ) {
        const eqIndex = ctx.code.lastIndexOf(
            "=",
            getWithLoc(node.expression).start,
        )
        const startIndex = ctx.code.lastIndexOf("this", eqIndex)
        const closeIndex = ctx.code.indexOf(
            "}",
            getWithLoc(node.expression).end,
        )
        const endIndex = indexOf(
            ctx.code,
            (c) => c === ">" || !c.trim(),
            closeIndex,
        )
        const thisAttr: SvelteSpecialDirective = {
            type: "SvelteSpecialDirective",
            kind: "this",
            expression: null as any,
            parent: element,
            ...ctx.getConvertLocation({ start: startIndex, end: endIndex }),
        }
        ctx.addToken("HTMLIdentifier", {
            start: startIndex,
            end: eqIndex,
        })
        const es = convertESNode(node.expression, thisAttr, ctx)
        analyzeExpressionScope(es, ctx)
        thisAttr.expression = es
        element.attributes.push(thisAttr)
    }

    extractElementTokens(element, ctx, {
        buildNameNode: (openTokenRange) => {
            const name: SvelteName = {
                type: "SvelteName",
                name: node.name,
                parent: element,
                ...ctx.getConvertLocation(openTokenRange),
            }
            return name
        },
    })

    return element
}

/** Convert for ComponentElement */
function convertComponentElement(
    node: SvAST.InlineComponent,
    parent: SvelteComponentElement["parent"],
    ctx: Context,
): SvelteComponentElement {
    const element: SvelteComponentElement = {
        type: "SvelteElement",
        kind: "component",
        name: null as any,
        attributes: [],
        children: [],
        parent,
        ...ctx.getConvertLocation(node),
    }
    element.attributes.push(...convertAttributes(node.attributes, element, ctx))
    element.children.push(...convertChildren(node, element, ctx))

    extractElementTokens(element, ctx, {
        buildNameNode: (openTokenRange) => {
            const name: ESTree.Identifier = {
                type: "Identifier",
                name: node.name,
                // @ts-expect-error -- ignore
                parent: element,
                ...ctx.getConvertLocation(openTokenRange),
            }
            return name
        },
    })
    analyzeExpressionScope(element.name, ctx)
    return element
}

/** Convert for Slot */
function convertSlotElement(
    node: SvAST.Slot,
    parent: SvelteHtmlElement["parent"],
    ctx: Context,
): SvelteHtmlElement {
    // Slot translates to SvelteHtmlElement.
    return convertHtmlElement(node, parent, ctx)
}

/** Convert for window element. e.g. <svelte:window> */
function convertWindowElement(
    node: SvAST.Window,
    parent: SvelteSpecialElement["parent"],
    ctx: Context,
): SvelteSpecialElement {
    return convertSpecialElement(node, parent, ctx)
}

/** Convert for body element. e.g. <svelte:body> */
function convertBodyElement(
    node: SvAST.Body,
    parent: SvelteSpecialElement["parent"],
    ctx: Context,
): SvelteSpecialElement {
    return convertSpecialElement(node, parent, ctx)
}

/** Convert for head element. e.g. <svelte:head> */
function convertHeadElement(
    node: SvAST.Head,
    parent: SvelteSpecialElement["parent"],
    ctx: Context,
): SvelteSpecialElement {
    return convertSpecialElement(node, parent, ctx)
}

/** Convert for options element. e.g. <svelte:options> */
function convertOptionsElement(
    node: SvAST.Options,
    parent: SvelteSpecialElement["parent"],
    ctx: Context,
): SvelteSpecialElement {
    return convertSpecialElement(node, parent, ctx)
}

/** Convert for <svelte:fragment> element. */
function convertSlotTemplateElement(
    node: SvAST.SlotTemplate,
    parent: SvelteSpecialElement["parent"],
    ctx: Context,
): SvelteSpecialElement {
    return convertSpecialElement(node, parent, ctx)
}

/** Extract element block tokens */
export function extractElementTokens<
    E extends SvelteScriptElement | SvelteElement | SvelteStyleElement
>(
    element: E,
    ctx: Context,
    options: {
        buildNameNode: (openTokenRange: {
            start: number
            end: number
        }) => E["name"]
        extractAttribute?: boolean
    },
): void {
    const startTagNameEnd = indexOf(
        ctx.code,
        (c) => c === "/" || c === ">" || !c.trim(),
        element.range[0] + 1,
    )
    const openTokenRange = {
        start: element.range[0] + 1,
        end: startTagNameEnd,
    }
    const openToken = ctx.addToken("HTMLIdentifier", openTokenRange)
    element.name = options.buildNameNode(openTokenRange)

    if (ctx.code[element.range[1] - 1] !== ">") {
        // Have not end tag
        return
    }
    if (ctx.code[element.range[1] - 2] === "/") {
        // self close
        return
    }

    const attrEnd = element.attributes.length
        ? element.attributes[element.attributes.length - 1].range[1]
        : openToken.range[1]

    const endTagOpen = ctx.code.lastIndexOf("<", element.range[1] - 1)
    if (endTagOpen <= attrEnd) {
        // void element
        return
    }
    const endTagNameStart = endTagOpen + 2
    const endTagNameEnd = indexOf(
        ctx.code,
        (c) => c === ">" || !c.trim(),
        endTagNameStart,
    )
    ctx.addToken("HTMLIdentifier", {
        start: endTagNameStart,
        end: endTagNameEnd,
    })
}
