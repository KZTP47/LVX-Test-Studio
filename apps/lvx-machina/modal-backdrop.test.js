const { shouldCloseModalBackdrop } = require('./modal-backdrop.js');

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`);
    }
}

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exit(1);
    }
}

test('shouldCloseModalBackdrop allows a real backdrop click', () => {
    const backdrop = { id: 'suite-modal' };
    const event = { target: backdrop, currentTarget: backdrop };
    assertEqual(shouldCloseModalBackdrop(backdrop, backdrop, event), true, 'Backdrop click should close the modal.');
});

test('shouldCloseModalBackdrop ignores drags that started inside modal content', () => {
    const backdrop = { id: 'suite-modal' };
    const content = { id: 'suite-modal-content' };
    const event = { target: backdrop, currentTarget: backdrop };
    assertEqual(shouldCloseModalBackdrop(backdrop, content, event), false, 'Selection drags from modal content should not close the modal.');
});

test('shouldCloseModalBackdrop ignores bubbled clicks from modal content', () => {
    const backdrop = { id: 'suite-modal' };
    const content = { id: 'suite-modal-content' };
    const event = { target: content, currentTarget: backdrop };
    assertEqual(shouldCloseModalBackdrop(backdrop, content, event), false, 'Clicks on inner modal content should not close the modal.');
});
