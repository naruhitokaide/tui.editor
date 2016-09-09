/**
 * @fileoverview Implements wysiwyg table manager
 * @author Sungho Kim(sungho-kim@nhnent.com) FE Development Lab/NHN Ent.
 * @author Junghwan Park(junghwan.park@nhnent.com) FE Development Lab/NHN Ent.
 */


import domUtils from './domUtils';
const isIE10 = tui.util.browser.msie && tui.util.browser.version === 10;
const TABLE_COMPLETION_DELAY = 10;
const SET_SELECTION_DELAY = 50;
const TABLE_CLASS_PREFIX = 'te-content-table-';
const isIE10And11 = tui.util.browser.msie
    && (tui.util.browser.version === 10 || tui.util.browser.version === 11);

/**
 * WwTableManager
 * @exports WwTableManager
 * @constructor
 * @class WwTableManager
 * @param {WysiwygEditor} wwe WysiwygEditor instance
 */
class WwTableManager {
    constructor(wwe) {
        this.wwe = wwe;
        this.eventManager = wwe.eventManager;

        /**
         * Name property
         * @api
         * @memberOf WwTableManager
         * @type {string}
         */
        this.name = 'table';

        this._lastCellNode = null;
        this._init();
    }

    /**
     * _init
     * Initialize
     * @memberOf WwTableManager
     * @private
     */
    _init() {
        this._initKeyHandler();
        this._initEvent();
        this.tableID = 0;
    }

    /**
     * _initEvent
     * Initialize event
     * @memberOf WwTableManager
     * @private
     */
    _initEvent() {
        this.eventManager.listen('wysiwygRangeChangeAfter', () => {
            this._unwrapBlockInTable();
            this.wwe.defer(() => {
                this._completeTableIfNeed();
            }, TABLE_COMPLETION_DELAY);
            this.wwe.getManager('tableSelection').removeClassAttrbuteFromAllCellsIfNeed();
            this._insertDefaultBlockBetweenTable();
        });

        this.eventManager.listen('wysiwygSetValueAfter', () => {
            this._unwrapBlockInTable();
            this._insertDefaultBlockBetweenTable();
        });

        //remove last br in td or th
        this.eventManager.listen('wysiwygProcessHTMLText', html => html.replace(/<br \/>(<\/td>|<\/th>)/g, '$1'));

        this.wwe.getEditor().addEventListener('paste', ev => {
            const range = this.wwe.getEditor().getSelection();
            const isNotPastingIntoTextNode = !domUtils.isTextNode(range.commonAncestorContainer);

            if (this.isInTable(range) && !range.collapsed && isNotPastingIntoTextNode) {
                ev.preventDefault();
            }
            this.wwe.defer(() => {
                this._completeTableIfNeed();
            }, TABLE_COMPLETION_DELAY);
        });
    }

    /**
     * _initKeyHandler
     * Initialize key event handler
     * @memberOf WwTableManager
     * @private
     */
    _initKeyHandler() {
        const selectionManager = this.wwe.getManager('tableSelection');

        this.wwe.addKeyEventHandler((ev, range, keymap) => {
            const isRangeInTable = this.isInTable(range);

            if (isRangeInTable && !this._isSingleModifierKey(keymap)) {
                this._recordUndoStateIfNeed(range);
                this._removeBRIfNeed(range);
                this._removeContentsAndChangeSelectionIfNeed(range, keymap, ev);
            } else if (!isRangeInTable && this._lastCellNode) {
                this._recordUndoStateAndResetCellNode(range);
            }

            if (!this._isModifierKeyPushed(ev)) {
                this.wwe.getEditor().modifyDocument(() => {
                    selectionManager.removeClassAttrbuteFromAllCellsIfNeed();
                });
            }
        });

        this.wwe.addKeyEventHandler('ENTER', (ev, range) => {
            let isNeedNext;

            if (this._isAfterTable(range)) {
                ev.preventDefault();
                range.setStart(range.startContainer, range.startOffset - 1);
                this.wwe.breakToNewDefaultBlock(range);
                isNeedNext = false;
            } else if (this._isBeforeTable(range)) {
                ev.preventDefault();
                this.wwe.breakToNewDefaultBlock(range, 'before');
                isNeedNext = false;
            } else if (this.isInTable(range)) {
                this._appendBrIfTdOrThNotHaveAsLastChild(range);
                isNeedNext = false;
            }

            return isNeedNext;
        });

        this.wwe.addKeyEventHandler('BACK_SPACE',
            (ev, range, keymap) => this._handleBackspaceAndDeleteKeyEvent(ev, range, keymap));
        this.wwe.addKeyEventHandler('DELETE',
            (ev, range, keymap) => this._handleBackspaceAndDeleteKeyEvent(ev, range, keymap));
        this.wwe.addKeyEventHandler('TAB', () => this._moveCursorTo('next', 'cell'));

        this.wwe.addKeyEventHandler('SHIFT+TAB', ev => this._moveCursorTo('previous', 'cell', ev));

        this._bindKeyEventForTableCopyAndCut();
    }

    /**
     * isInTable
     * Check whether passed range is in table or not
     * @param {Range} range range
     * @returns {boolean} result
     * @memberOf WwTableManager
     * @api
     */
    isInTable(range) {
        let target, result;

        if (range.collapsed) {
            target = range.startContainer;
            result = !!$(target).closest('table').length;
        } else {
            target = range.commonAncestorContainer;
            result = !!$(target).closest('table').length || !!$(range.cloneContents()).find('table').length;
        }

        return result;
    }

    /**
     * _isBeforeTable
     * Check whether passed range is right before table or not
     * @param {Range} range range
     * @returns {boolean} result
     * @memberOf WwTableManager
     * @private
     */
    _isBeforeTable(range) {
        return domUtils.getNodeName(domUtils.getChildNodeByOffset(range.startContainer, range.startOffset)) === 'TABLE';
    }

    /**
     * _isAfterTable
     * Check whether passed range is right after table or not
     * @param {Range} range range
     * @returns {boolean} result
     * @memberOf WwTableManager
     * @private
     */
    _isAfterTable(range) {
        const prevElem = domUtils.getPrevOffsetNodeUntil(range.startContainer, range.startOffset);

        return domUtils.getNodeName(prevElem) === 'TABLE' && range.commonAncestorContainer === this.wwe.get$Body()[0];
    }

    /**
     * Handle backspace and delete key event
     * @param {object} ev Event object
     * @param {Range} range Range Object
     * @param {string} keymap keymap
     * @returns {boolean|null}
     * @private
     */
    _handleBackspaceAndDeleteKeyEvent(ev, range, keymap) {
        const isBackspace = keymap === 'BACK_SPACE';
        const isTextOrElementDelete = range.commonAncestorContainer.nodeType !== 3
            && range.commonAncestorContainer !== this.wwe.get$Body()[0];
        let isNeedNext;

        if (range.collapsed) {
            if (this.isInTable(range)) {
                if (isBackspace) {
                    this._tableHandlerOnBackspace(range, ev);
                } else {
                    this._tableHandlerOnDelete(range, ev);
                }

                this._insertBRIfNeed(range);
                this._removeContentsAndChangeSelectionIfNeed(range, keymap, ev);
                isNeedNext = false;
            } else if ((isBackspace && this._isBeforeTable(range))
                || (!isBackspace && this._isAfterTable(range))
            ) {
                ev.preventDefault();
                this._removeTableOnBackspace(range);
                isNeedNext = false;
            }
        } else if (this.isInTable(range)) {
            if (isTextOrElementDelete) {
                ev.preventDefault();
                this._removeContentsAndChangeSelectionIfNeed(range, keymap, ev);
                isNeedNext = false;
            }
        }

        return isNeedNext;
    }

    /**
     * _tableHandlerOnBackspace
     * Backspace handler in table
     * @param {Range} range range
     * @param {Event} event event
     * @memberOf WwTableManager
     * @private
     */
    _tableHandlerOnBackspace(range, event) {
        const prevNode = domUtils.getPrevOffsetNodeUntil(range.startContainer, range.startOffset, 'TR'),
            prevNodeName = domUtils.getNodeName(prevNode);

        if (!prevNode || prevNodeName === 'TD' || prevNodeName === 'TH') {
            event.preventDefault();
        } else if (prevNodeName === 'BR' && prevNode.parentNode.childNodes.length !== 1) {
            event.preventDefault();
            $(prevNode).remove();
        }
    }
    /**
     * Return whether delete non text or not
     * @param {Range} range Range object
     * @returns {boolean}
     */
    isNonTextDeleting(range) {
        const currentElement = range.startContainer;
        const nextNode = currentElement.nextSibling;
        const nextNodeName = domUtils.getNodeName(nextNode);
        const currentNodeName = domUtils.getNodeName(currentElement);

        const isCellDeleting = currentNodeName === nextNodeName && currentNodeName !== 'TEXT';
        const isEndOfText = (!nextNode || (nextNodeName === 'BR' && nextNode.parentNode.lastChild === nextNode))
            && (domUtils.isTextNode(currentElement) && range.startOffset === currentElement.nodeValue.length);
        const isLastCellOfRow = !isEndOfText
            && $(currentElement).parents('tr').children().last()[0] === currentElement
            && (currentNodeName === 'TD' || currentNodeName === 'TH');

        return isCellDeleting || isEndOfText || isLastCellOfRow;
    }
    /**
     * _tableHandlerOnDelete
     * Delete handler in table
     * @param {Range} range range
     * @param {Event} event event
     * @memberOf WwTableManager
     * @private
     */
    _tableHandlerOnDelete(range, event) {
        const needPreventDefault = this.isNonTextDeleting(range);

        if (needPreventDefault) {
            event.preventDefault();
            range.startContainer.normalize();
        }
    }

    /**
     * _appendBrIfTdOrThNotHaveAsLastChild
     * Append br if td or th doesn't have br as last child
     * @param {Range} range range
     * @memberOf WwTableManager
     * @private
     */
    _appendBrIfTdOrThNotHaveAsLastChild(range) {
        const startContainerNodeName = domUtils.getNodeName(range.startContainer);
        let tdOrTh;

        if (startContainerNodeName === 'TD' || startContainerNodeName === 'TH') {
            tdOrTh = range.startContainer;
        } else {
            const paths = $(range.startContainer).parentsUntil('tr');
            tdOrTh = paths[paths.length - 1];
        }

        if (domUtils.getNodeName(tdOrTh.lastChild) !== 'BR'
            && domUtils.getNodeName(tdOrTh.lastChild) !== 'DIV'
            && !isIE10And11
        ) {
            $(tdOrTh).append($('<br />')[0]);
        }
    }

    /**
     * _unwrapBlockInTable
     * Unwrap default block tag in table
     * For Squire default action making abnormal behavior, remove default blocks in Table after setValue() called
     * @memberOf WwTableManager
     * @private
     */
    _unwrapBlockInTable() {
        this.wwe.get$Body().find('td div,th div,tr>br,td>br,th>br').each((index, node) => {
            if (domUtils.getNodeName(node) === 'BR') {
                const parentNodeName = domUtils.getNodeName(node.parentNode);
                const isInTableCell = /TD|TH/.test(parentNodeName);
                const isEmptyTableCell = node.parentNode.textContent.length === 0;
                const isLastBR = node.parentNode.lastChild === node;

                if (parentNodeName === 'TR' || (isInTableCell && !isEmptyTableCell && isLastBR)) {
                    $(node).remove();
                }
            } else {
                $(node).children().unwrap();
            }
        });
    }

    /**
     * Insert default block between table element
     * @private
     */
    _insertDefaultBlockBetweenTable() {
        this.wwe.get$Body().find('table').each((index, node) => {
            if (node.nextElementSibling
                && node.nextElementSibling.nodeName === 'TABLE'
            ) {
                $('<div><br /></div>').insertAfter(node);
            }
        });
    }

    /**
     * _removeTableOnBackspace
     * Remove table on backspace
     * @param {Range} range range
     * @memberOf WwTableManager
     * @private
     */
    _removeTableOnBackspace(range) {
        const table = domUtils.getChildNodeByOffset(range.startContainer, range.startOffset);

        this.wwe.getEditor().saveUndoState(range);

        this.wwe.insertSelectionMarker(range);
        $(table).remove();
        this.wwe.restoreSelectionMarker();
    }

    /**
     * _recordUndoStateIfNeed
     * record undo state if need
     * @param {Range} range range
     * @memberOf WwTableManager
     * @private
     */
    _recordUndoStateIfNeed(range) {
        const currentCellNode = domUtils.getParentUntil(range.startContainer, 'TR');

        if (range.collapsed && this._lastCellNode !== currentCellNode) {
            this.wwe.getEditor().saveUndoState(range);
            this._lastCellNode = currentCellNode;
        }
    }

    /**
     * _recordUndoStateAndResetCellNode
     * record undo state and reset last cell node
     * @param {Range} range range
     * @memberOf WwTableManager
     * @private
     */
    _recordUndoStateAndResetCellNode(range) {
        this.wwe.getEditor().saveUndoState(range);
        this.resetLastCellNode();
    }

    /**
     * Paste table data into table element
     * @param {DocumentFragment} fragment Fragment of table element within
     * @private
     */
    _pasteDataIntoTable(fragment) {
        const range = this.wwe.getEditor().getSelection();
        const tableData = this._getTableDataFromTable(fragment);
        const startContainer = range.startContainer;
        const parentNode = startContainer.parentNode;
        const isTextInTableCell = (parentNode.tagName === 'TD' || parentNode.tagName === 'TH');
        const isTableCell = (startContainer.tagName === 'TD' || startContainer.tagName === 'TH');
        const isTextNode = startContainer.nodeType === 3;
        const brString = isIE10 ? '' : '<br />';
        let anchorElement, td, tr, tdContent;

        if (isTextNode && isTextInTableCell) {
            anchorElement = parentNode;
        } else if (isTableCell) {
            anchorElement = startContainer;
        } else {
            anchorElement = $(startContainer).find('th,td')[0];
        }

        td = anchorElement;

        while (tableData.length) {
            tr = tableData.shift();

            while (td && tr.length) {
                tdContent = tr.shift();

                if (tdContent.length) {
                    td.textContent = tdContent;
                } else {
                    td.innerHTML = brString;
                }

                td = domUtils.getTableCellByDirection(td, 'next');
            }

            td = domUtils.getSiblingRowCellByDirection(anchorElement, 'next', false);
            anchorElement = td;
        }
    }

    /**
     * Get array data from table element
     * @param {DocumentFragment} fragment table element
     * @returns {Array}
     * @private
     */
    _getTableDataFromTable(fragment) {
        const $fragment = $(fragment);
        const tableData = [];
        const trs = $fragment.find('tr');

        trs.each((i, tr) => {
            const trData = [];
            const tds = $(tr).children();

            tds.each((index, cell) => {
                trData.push(cell.textContent);
            });

            if (trData.length) {
                tableData.push(trData);
            }
        });

        return tableData;
    }

    /**
     * Remove selected table contents
     * @param {jQuery} selectedCells Selected cells wrapped by jQuery
     * @private
     */
    _removeTableContents(selectedCells) {
        this.wwe.getEditor().saveUndoState();

        selectedCells.each((i, cell) => {
            const brHTMLString = isIE10 ? '' : '<br />';
            $(cell).html(brHTMLString);
        });
    }

    /**
     * Wrap dangling table cells with new TR
     * @param {DocumentFragment} fragment Pasting data
     * @returns {HTMLElement|null}
     */
    wrapDanglingTableCellsIntoTrIfNeed(fragment) {
        const danglingTableCells = $(fragment).children('td,th');
        let tr;

        if (danglingTableCells.length) {
            const $wrapperTr = $('<tr></tr>');

            danglingTableCells.each((i, cell) => {
                $wrapperTr.append(cell);
            });

            tr = $wrapperTr[0];
        }

        return tr;
    }

    /**
     * Wrap TRs with new TBODY
     * @param {DocumentFragment} fragment Pasting data
     * @returns {HTMLElement|null}
     */
    wrapTrsIntoTbodyIfNeed(fragment) {
        const danglingTrs = $(fragment).children('tr');
        const ths = danglingTrs.find('th');
        let tbody;

        if (ths.length) {
            ths.each((i, node) => {
                const $node = $(node);
                const td = $('<td></td>');

                td.html($node.html());
                td.insertBefore(node);

                $node.detach();
            });
        }

        if (danglingTrs.length) {
            const $wrapperTableBody = $('<tbody></tbody>');

            danglingTrs.each((i, tr) => {
                $wrapperTableBody.append(tr);
            });

            tbody = $wrapperTableBody[0];
        }

        return tbody;
    }

    /**
     * Wrap THEAD followed by TBODY both into Table
     * @param {DocumentFragment} fragment Pasting data
     * @returns {HTMLElement|null}
     */
    wrapTheadAndTbodyIntoTableIfNeed(fragment) {
        const danglingThead = $(fragment).children('thead');
        const danglingTbody = $(fragment).children('tbody');
        const $wrapperTable = $('<table></table>');
        let table;

        if (!danglingTbody.length && danglingThead.length) {
            $wrapperTable.append(danglingThead[0]);
            $wrapperTable.append('<tbody><tr></tr></tbody>');
            table = $wrapperTable[0];
        } else if (danglingTbody.length && !danglingThead.length) {
            $wrapperTable.append('<thead><tr></tr></thead>');
            $wrapperTable.append(danglingTbody[0]);
            table = $wrapperTable[0];
        } else if (danglingTbody.length && danglingThead.length) {
            $wrapperTable.append(danglingThead[0]);
            $wrapperTable.append(danglingTbody[0]);
            table = $wrapperTable[0];
        }

        return table;
    }
    /**
     * Prepare to paste data on table
     * @param {object} pasteData Pasting data
     * @param {HTMLElement} node Current pasting element
     * @returns {DocumentFragment}
     * @memberOf WwTableManager
     * @api
     */
    prepareToPasteOnTable(pasteData, node) {
        const newFragment = document.createDocumentFragment();
        if (this._isTableOrSubTableElement(node.nodeName)) {
            this._expandTableIfNeed(pasteData.fragment);
            this._pasteDataIntoTable(pasteData.fragment);
            pasteData.fragment = newFragment;
        } else {
            newFragment.textContent = newFragment.textContent + pasteData.fragment.textContent;
        }

        return newFragment;
    }

    /**
     * Whether pasting element is table element
     * @param {string} pastingNodeName Pasting node name
     * @returns {boolean}
     * @private
     */
    _isTableOrSubTableElement(pastingNodeName) {
        return (pastingNodeName === 'TABLE' || pastingNodeName === 'TBODY'
            || pastingNodeName === 'THEAD' || pastingNodeName === 'TR' || pastingNodeName === 'TD');
    }

    /**
     * Stuff table cells into incomplete rows
     * @param {jQuery} $trs jQuery wrapped TRs
     * @param {number} maximumCellLength maximum cell length of table
     * @private
     */
    _stuffTableCellsIntoIncompleteRow($trs, maximumCellLength) {
        $trs.each((rowIndex, row) => {
            const $row = $(row);
            const tableCells = $row.find('th,td');
            const parentNodeName = domUtils.getNodeName($row.parent()[0]);
            const cellTagName = parentNodeName === 'THEAD' ? 'th' : 'td';

            for (let cellLength = tableCells.length; cellLength < maximumCellLength; cellLength += 1) {
                $row.append($(tableCellGenerator(1, cellTagName))[0]);
            }
        });
    }

    /**
     * Prepare to table cell stuffing
     * @param {jQuery} $trs jQuery wrapped TRs
     * @returns {{maximumCellLength: *, needTableCellStuffingAid: boolean}}
     * @private
     */
    _prepareToTableCellStuffing($trs) {
        let maximumCellLength = $trs.eq(0).find('th,td').length;
        let needTableCellStuffingAid = false;

        $trs.each((i, row) => {
            const cellCount = $(row).find('th,td').length;

            if (maximumCellLength !== cellCount) {
                needTableCellStuffingAid = true;

                if (maximumCellLength < cellCount) {
                    maximumCellLength = cellCount;
                }
            }
        });

        return {
            maximumCellLength,
            needTableCellStuffingAid
        };
    }

    /**
     * Add TBODY or THEAD if need
     * @param {jQuery} table Table element
     * @private
     */
    _addTbodyOrTheadIfNeed(table) {
        const isTheadNotExists = !table.find('thead').length;
        const isTbodyNotExists = !table.find('tbody').length;
        let absentNode;

        if (isTheadNotExists) {
            absentNode = $('<thead><tr></tr></thead>')[0];
            table.prepend(absentNode);
        } else if (isTbodyNotExists) {
            absentNode = $('<tbody><tr></tr></tbody>')[0];
            table.append(absentNode);
        }
    }

    /**
     * Append table cells
     * @param {HTMLElement} node Table element
     * @private
     */
    _tableCellAppendAidForTableElement(node) {
        const table = $(node);

        this._addTbodyOrTheadIfNeed(table);
        this._addTrIntoContainerIfNeed(table);

        const trs = table.find('tr');
        const tableAidInformation = this._prepareToTableCellStuffing(trs);
        const maximumCellLength = tableAidInformation.maximumCellLength;
        const needTableCellStuffingAid = tableAidInformation.needTableCellStuffingAid;

        if (needTableCellStuffingAid) {
            this._stuffTableCellsIntoIncompleteRow(trs, maximumCellLength);
        }
    }

    /**
     * Generate THEAD and append TDs with same amount of given TBODY
     * @param {HTMLElement} node TR element
     * @returns {{thead: HTMLElement, tbody: HTMLElement}}
     * @private
     */
    _generateTheadAndTbodyFromTbody(node) {
        const tr = $('<tr></tr>');
        const thead = $('<thead></thead>');

        tr.append(tableCellGenerator($(node).find('tr').eq(0).find('td').length, 'th'));
        thead.append(tr);

        return {
            thead: thead[0],
            tbody: node
        };
    }

    /**
     * Generate TBODY and append TDs with same amount of given THEAD
     * @param {HTMLElement} node TR element
     * @returns {{thead: HTMLElement, tbody: HTMLElement}}
     * @private
     */
    _generateTheadAndTbodyFromThead(node) {
        const tr = $('<tr></tr>');
        const tbody = $('<tbody></tbody>');

        tr.append(tableCellGenerator($(node).find('th').length, 'td'));
        tbody.append(tr);

        return {
            thead: node,
            tbody: tbody[0]
        };
    }

    /**
     * Generate THEAD and TBODY and append given TR within
     * @param {HTMLElement} node TR element
     * @returns {{thead: HTMLElement, tbody: HTMLElement}}
     * @private
     */
    _generateTheadAndTbodyFromTr(node) {
        const $node = $(node);
        const thead = $('<thead></thead>');
        const tbody = $('<tbody></tbody>');
        let theadRow, tbodyRow;

        if ($node.children()[0].tagName === 'TH') {
            theadRow = node;
            tbodyRow = $(`<tr>${tableCellGenerator($node.find('th').length, 'td')}</tr>`)[0];
        } else {
            theadRow = $(`<tr>${tableCellGenerator($node.find('td').length, 'th')}</tr>`)[0];
            tbodyRow = node;
        }

        thead.append(theadRow);
        tbody.append(tbodyRow);

        return {
            thead: thead[0],
            tbody: tbody[0]
        };
    }

    /**
     * Complete passed table
     * @param {HTMLElement} node Table inner element
     * @private
     */
    _completeIncompleteTable(node) {
        const nodeName = node.tagName;
        let table, completedTableContents;

        if (nodeName === 'TABLE') {
            table = node;
        } else {
            table = $('<table></table>');
            table.insertAfter(node);

            if (nodeName === 'TBODY') {
                completedTableContents = this._generateTheadAndTbodyFromTbody(node);
            } else if (nodeName === 'THEAD') {
                completedTableContents = this._generateTheadAndTbodyFromThead(node);
            } else if (nodeName === 'TR') {
                completedTableContents = this._generateTheadAndTbodyFromTr(node);
            }
            table.append(completedTableContents.thead);
            table.append(completedTableContents.tbody);
        }
        this._tableCellAppendAidForTableElement(table);
    }

    /**
     * Whole editor body searching incomplete table completion
     * @private
     */
    _completeTableIfNeed() {
        const $body = this.wwe.getEditor().get$Body();

        $body.children().each((index, node) => {
            const $node = $(node);

            if (!this._isTableOrSubTableElement(node.nodeName)) {
                return;
            } else if (node.nodeName === 'TABLE'
                && $node.find('thead').length === 0
                && $node.find('tbody').length === 0
            ) {
                $node.remove();
            }

            this._completeIncompleteTable(node);
        });
    }

    /**
     * Reset _lastCellNode to null
     * @memberOf WwTableManager
     */
    resetLastCellNode() {
        this._lastCellNode = null;
    }
    /**
     * Set _lastCellNode to given node
     * @param {HTMLElement} node Table cell
     * @memberOf WwTableManager
     */
    setLastCellNode(node) {
        this._lastCellNode = node;
    }

    /**
     * Return whether only modifier key pressed or not
     * @param {string} keymap Pressed keymap string
     * @returns {boolean}
     * @private
     */
    _isSingleModifierKey(keymap) {
        return ((keymap === 'META') && (keymap === 'SHIFT') && (keymap === 'ALT') && (keymap === 'CONTROL'));
    }

    /**
     * Return whether modifier keys pressed or not
     * @param {object} ev keyboard event object
     * @returns {boolean}
     * @private
     */
    _isModifierKeyPushed(ev) {
        return (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey);
    }

    /**
     * Add one row into empty TBODY
     * @param {jQuery} $table Currently processing table
     * @private
     */
    _addTrIntoContainerIfNeed($table) {
        const $trContainers = $table.children();

        $trContainers.each((i, container) => {
            const hasNoRows = $(container).find('tr').length === 0;

            if (hasNoRows) {
                $(container).append($('<tr></tr>')[0]);
            }
        });
    }

    _expandTableIfNeed(fragment) {
        const range = this.wwe.getEditor().getSelection().cloneRange();
        const $table = $(range.startContainer).parents('table');
        const difference = this._getColumnAndRowDifference(fragment, range);

        if (difference.column < 0) {
            this._appendCellForAllRow($table, difference.column);
        }

        if (difference.row < 0) {
            this._appendRow($table, difference.row);
        }
    }

    _getColumnAndRowDifference(fragment, range) {
        const tableData = this._getTableDataFromTable(fragment);
        const rowLength = tableData.length;
        const columnLength = tableData[0].length;
        const $currentCell = $(range.startContainer).closest('th,td');
        const $currentRow = $currentCell.parent();
        const currentColumnIndex = domUtils.getNodeOffsetOfParent($currentCell[0]);
        let currentRowIndex = domUtils.getNodeOffsetOfParent($currentCell[0].parentNode);
        const $table = $currentRow.parents('table');
        const tableColumnLength = $table.find('tr').eq(0).children().length;
        const tableRowLength = $table.find('tr').length;
        const isInTbody = $currentRow.parents('tbody').length;

        if (isInTbody) {
            currentRowIndex += 1;
        }

        return {
            row: tableRowLength - (currentRowIndex + rowLength),
            column: tableColumnLength - (currentColumnIndex + columnLength)
        };
    }

    _appendCellForAllRow($table, columnDifference) {
        const brString = isIE10 ? '' : '<br />';

        $table.find('tr').each((i, row) => {
            let tagName;

            for (let index = columnDifference; index < 0; index += 1) {
                if (i === 0) {
                    tagName = 'th';
                } else {
                    tagName = 'td';
                }
                $(row).append($(`<${tagName}>${brString}</${tagName}>`)[0]);
            }
        });
    }

    _appendRow($table, rowDifference) {
        const newRow = $table.find('tr').last().clone();
        const brHTMLSting = isIE10 ? '' : '<br />';

        newRow.find('td').html(brHTMLSting);

        for (; rowDifference < 0; rowDifference += 1) {
            $table.find('tbody').append(newRow.clone()[0]);
        }
    }

    /**
     * Get sibling textNode by given direction
     * @param {HTMLElement} currentTextNode Current text node
     * @param {boolean} isNext Boolean value whether direction equals 'next'
     * @returns {boolean|null}
     * @private
     */
    _getSiblingTextNodeByDirection(currentTextNode, isNext) {
        const isPreviousLineExist = currentTextNode.previousSibling
            && currentTextNode.previousSibling.nodeName === 'BR'
            && currentTextNode.previousSibling.previousSibling
            && currentTextNode.previousSibling.previousSibling.nodeType === 3;
        const isNextLineExist = currentTextNode.nextSibling
            && currentTextNode.nextSibling.nodeName === 'BR'
            && currentTextNode.nextSibling.nextSibling
            && currentTextNode.nextSibling.nextSibling.nodeType === 3;
        let target;

        if (isNext && isNextLineExist) {
            target = currentTextNode.nextSibling.nextSibling;
        } else if (!isNext && isPreviousLineExist) {
            target = currentTextNode.previousSibling.previousSibling;
        }

        return target;
    }

    /**
     * Change selection to sibling cell
     * @param {HTMLElement} currentCell current TD or TH
     * @param {Range} range Range object
     * @param {string} direction 'next' or 'previous'
     * @param {string} scale 'row' or 'cell'
     */
    _changeSelectionToTargetCell(currentCell, range, direction, scale) {
        const startContainer = range.startContainer;
        const isNext = direction === 'next';
        const isRow = scale === 'row';
        let target, textOffset;

        if (isRow) {
            if (domUtils.isTextNode(startContainer)) {
                target = this._getSiblingTextNodeByDirection(startContainer, isNext);
                if (target) {
                    textOffset = target.length < range.startOffset ? target.length : range.startOffset;

                    range.setStart(target, textOffset);
                    range.collapse(true);

                    return;
                }
            }

            target = domUtils.getSiblingRowCellByDirection(currentCell, direction, false);
        } else {
            target = domUtils.getTableCellByDirection(currentCell, direction);
            if (!target) {
                target = domUtils.getSiblingRowCellByDirection(currentCell, direction, true);
            }
        }

        if (target) {
            range.setStart(target, 0);
            range.collapse(true);
        } else {
            target = $(currentCell).parents('table')[0];
            if (isNext) {
                range.setStart(target.nextElementSibling, 0);
            } else if (target.previousElementSibling && target.previousElementSibling.nodeName !== 'TABLE') {
                range.setStart(target.previousElementSibling, 1);
            } else {
                range.setStartBefore(target);
            }

            range.collapse(true);
        }
    }

    /**
     * Create selection by selected cells and collapse that selection to end
     * @private
     */
    _collapseRangeToEndContainer() {
        const sq = this.wwe.getEditor();
        const range = sq.getSelection().cloneRange();
        const selectedCells = this.wwe.getManager('tableSelection').getSelectedCells();

        if (selectedCells.length && this.isInTable(range)) {
            this.wwe.defer(() => {
                range.collapse(false);
                sq.setSelection(range);
            }, SET_SELECTION_DELAY);
        }
    }

    /**
     * Move cursor to given direction by interval formatter
     * @param {string} direction 'next' or 'previous'
     * @param {string} interval 'row' or 'cell'
     * @param {object} [ev] Event object
     * @returns {boolean | null}
     * @private
     */
    _moveCursorTo(direction, interval, ev) {
        const sq = this.wwe.getEditor();
        const range = sq.getSelection().cloneRange();
        const currentCell = $(range.startContainer).closest('td,th')[0];
        let isNeedNext;

        if (range.collapsed) {
            if (this.isInTable(range) && currentCell) {
                if (direction === 'previous' || interval === 'row' && !tui.util.isUndefined(ev)) {
                    ev.preventDefault();
                }

                this._changeSelectionToTargetCell(currentCell, range, direction, interval);
                sq.setSelection(range);

                isNeedNext = false;
            }
        }

        return isNeedNext;
    }

    /**
     * Bind pre process for table copy and cut key event
     * @private
     */
    _bindKeyEventForTableCopyAndCut() {
        const isMac = /Mac OS X/.test(navigator.userAgent);
        const commandKey = isMac ? 'metaKey' : 'ctrlKey';
        const selectionManager = this.wwe.getManager('tableSelection');

        this.wwe.getEditor().addEventListener('keydown', event => {
            if (event[commandKey]) {
                selectionManager.createRangeBySelectedCells();
            }
        });

        this.wwe.getEditor().addEventListener('keyup', () => {
            this._collapseRangeToEndContainer();
        });
    }

    /**
     * Remove contents and change selection if need
     * @param {Range} range Range object
     * @param {string} keymap keymap
     * @param {object} ev Event object
     * @private
     */
    _removeContentsAndChangeSelectionIfNeed(range, keymap, ev) {
        const isTextInput = keymap.length <= 1;
        const isDeleteOperation = (keymap === 'BACK_SPACE' || keymap === 'DELETE');
        const selectedCells = this.wwe.getManager('tableSelection').getSelectedCells();
        const firstSelectedCell = selectedCells.first()[0];

        if ((isTextInput || isDeleteOperation) && !this._isModifierKeyPushed(ev) && selectedCells.length) {
            if (isDeleteOperation) {
                this._recordUndoStateIfNeed(range);
            }
            this._removeTableContents(selectedCells);

            this._lastCellNode = firstSelectedCell;

            range.setStart(firstSelectedCell, 0);
            range.collapse(true);
            this.wwe.getEditor().setSelection(range);
        }
    }

    /**
     * Return new table ID class name string
     * @returns {string}
     * @memberOf WwTableManager
     * @api
     */
    getTableIDClassName() {
        const tableClassName = TABLE_CLASS_PREFIX + this.tableID;
        this.tableID += 1;

        return tableClassName;
    }

    /**
     * Remove br when text inputted
     * @param {Range} range Range object
     * @private
     */
    _removeBRIfNeed(range) {
        const startContainer = domUtils.isTextNode(range.startContainer)
            ? range.startContainer.parentNode : range.startContainer;
        const nodeName = domUtils.getNodeName(startContainer);

        if (/td|th/i.test(nodeName) && range.collapsed && startContainer.textContent.length === 1) {
            $(startContainer).find('br').remove();
        }
    }


    /**
     * Insert br when text deleted
     * @param {Range} range Range object
     * @private
     */
    _insertBRIfNeed(range) {
        const currentCell = range.startContainer.nodeType === 3
            ? range.startContainer.parentNode : range.startContainer;
        const nodeName = domUtils.getNodeName(currentCell);
        const $currentCell = $(currentCell);

        if (/td|th/i.test(nodeName)
            && range.collapsed
            && !currentCell.textContent.length
            && !$currentCell.children().length
            && !isIE10And11
        ) {
            currentCell.normalize();
            $currentCell.append('<br>');
        }
    }
}

/**
 * Generate table cell HTML text
 * @param {number} amount Amount of cells
 * @param {string} tagName Tag name of cell 'td' or 'th'
 * @private
 * @returns {string}
 */
function tableCellGenerator(amount, tagName) {
    const brHTMLString = '<br />';
    const cellString = `<${tagName}>${brHTMLString}</${tagName}>`;
    let tdString = '';

    for (let i = 0; i < amount; i += 1) {
        tdString = tdString + cellString;
    }

    return tdString;
}
module.exports = WwTableManager;
