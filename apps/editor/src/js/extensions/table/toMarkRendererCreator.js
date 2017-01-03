/**
 * @fileoverview Implements toMarkRendererCreator.
 * @author Jiung Kang(jiung.kang@nhnent.com) FE Development Lab/NHN Ent.
 */

const toMark = window.toMark;
const RX_COLS = /@cols=[0-9]+:/g;
let toMarkRenderer = null;

/**
 * Make table head align text.
 * Copy from https://github.com/nhnent/toMark/blob/develop/src/renderer.gfm.js
 * @param {HTMLElement} thElement - Table head cell element
 * @returns {string}
 * @private
 */
function _makeTableHeadAlignText(thElement) {
    const align = thElement.align;
    const textContent = (thElement.textContent || thElement.innerText).replace(RX_COLS, '');
    let textLength = textContent.length;
    let leftAlignValue = '';
    let rightAlignValue = '';

    if (align) {
        if (align === 'left') {
            leftAlignValue = ':';
            textLength -= 1;
        } else if (align === 'right') {
            rightAlignValue = ':';
            textLength -= 1;
        } else if (align === 'center') {
            rightAlignValue = ':';
            leftAlignValue = ':';
            textLength -= 2;
        }
    }

    textLength = Math.max(textLength, 3);

    return leftAlignValue + '-'.repeat(textLength) + rightAlignValue;
}

/**
 * Get additional th element count.
 * @param {Array.<HTMLElement>} ths - th element list
 * @private
 * @returns {Number}
 */
export function _getAdditionalThCount(ths) {
    let additionalThCount = 0;

    ths.filter(th => $(th).attr('colspan')).forEach(th => {
        additionalThCount += (parseInt($(th).attr('colspan'), 10) - 1);
    });

    return additionalThCount;
}

/**
 * Create thead markdown.
 * @param {HTMLElement} theadElement - theadElement element
 * @param {string} theadContentMarkdown - thead markdown content
 * @returns {string}
 */
export function _createTheadMarkdown(theadElement, theadContentMarkdown) {
    const ths = $(theadElement).find('th').get();
    let align = ths.map(th => ` ${_makeTableHeadAlignText(th)} |`).join('');

    align += ' --- |'.repeat(_getAdditionalThCount(ths));

    return theadContentMarkdown ? `${theadContentMarkdown}|${align}\n` : '';
}

export default toMark.Renderer.factory(toMark.gfmRenderer, {
    'THEAD': _createTheadMarkdown
});

