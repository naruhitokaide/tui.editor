const PopupAddLink = require('../../src/js/ui/popupAddLink');
const EventManager = require('../../src/js/eventManager');

describe('PopupAddLink', () => {
    let popup,
        em,
        selectedText;

    beforeEach(() => {
        em = new EventManager();

        popup = new PopupAddLink({
            editor: {
                getSelectedText: () => selectedText || '',
                eventManager: em
            }
        });
    });

    afterEach(() => {
        $('body').empty();
    });

    describe('init', () => {
        it('popupAddLink class added', () => {
            expect(popup.$el.hasClass('te-popup-add-link')).toBe(true);
        });
        it('buttons', () => {
            expect(popup.$el.find('.te-close-button').length).toEqual(1);
            expect(popup.$el.find('.te-ok-button').length).toEqual(1);
        });
    });

    describe('button events', () => {
        let handler = jasmine.createSpy('buttonClickedHandler');

        beforeEach(() => {
            handler = jasmine.createSpy('buttonClickedHandler');
        });

        it('ok button fires okButtonClicked event', () => {
            popup.on('okButtonClicked', handler);

            $('.te-ok-button').trigger('click');

            expect(handler).toHaveBeenCalled();
        });

        it('close button fires closeButtonClicked event', () => {
            popup.on('closeButtonClicked', handler);

            $('.te-close-button').trigger('click');

            expect(handler).toHaveBeenCalled();
        });
    });

    describe('integrates with eventManager', () => {
        let handler;

        beforeEach(() => {
            handler = jasmine.createSpy('buttonClickedHandler');
        });

        it('okButtonClicked fires command', () => {
            const value = {
                linkText: 'linkText',
                url: 'urlText'
            };

            em.listen('command', handler);
            $('.te-link-text-input').val(value.linkText);
            $('.te-url-input').val(value.url);

            $('.te-ok-button').trigger('click');

            expect(handler).toHaveBeenCalledWith('AddLink', value);
        });

        it('openPopupAddLink event opens popup', () => {
            em.emit('openPopupAddLink');

            expect(popup.isShow()).toBe(true);
        });

        it('closeAllPopup event closes popup', () => {
            em.emit('openPopupAddLink');
            em.emit('closeAllPopup');

            expect(popup.isShow()).toBe(false);
        });
    });

    describe('url입력 방식', () => {
        it('getValue() returns text/url values', () => {
            $('.te-link-text-input').val('myLinkText');
            $('.te-url-input').val('myUrl');

            const value = popup.getValue();

            expect(value.linkText).toEqual('myLinkText');
            expect(value.url).toEqual('myUrl');
        });

        it('clear text fields after popup closed', () => {
            $('.te-link-text-input').val('myLinkText');
            $('.te-url-input').val('myUrl');

            popup.hide();
            const value = popup.getValue();

            expect(value.linkText).toEqual('');
            expect(value.url).toEqual('');
        });
    });

    describe('show()', () => {
        it('load selected text from editor', () => {
            selectedText = 'text';
            popup.show();

            const value = popup.getValue();

            expect(value.linkText).toEqual(selectedText);
        });

        it('load selected url text from editor and fill url too', () => {
            selectedText = 'http://www.nhnent.com';
            popup.show();

            const value = popup.getValue();

            expect(value.linkText).toEqual(selectedText);
            expect(value.url).toEqual(selectedText);
        });
    });
});
