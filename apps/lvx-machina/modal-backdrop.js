(function (globalScope) {
    function shouldCloseModalBackdrop(backdrop, pointerDownTarget, event) {
        return Boolean(backdrop) &&
            pointerDownTarget === backdrop &&
            event?.target === backdrop &&
            event?.currentTarget === backdrop;
    }

    function installSafeBackdropCloser(backdrop, closeHandler) {
        if (!backdrop || typeof closeHandler !== 'function') return;

        let pointerDownTarget = null;

        backdrop.addEventListener('mousedown', (event) => {
            pointerDownTarget = event.target;
        });

        backdrop.addEventListener('click', (event) => {
            const shouldClose = shouldCloseModalBackdrop(backdrop, pointerDownTarget, event);
            pointerDownTarget = null;

            if (shouldClose) {
                closeHandler(event);
            }
        });
    }

    function attachSafeBackdropClosers(root = document) {
        root.querySelectorAll('[data-backdrop-close]').forEach((backdrop) => {
            if (backdrop.dataset.backdropCloseBound === 'true') return;

            backdrop.dataset.backdropCloseBound = 'true';

            installSafeBackdropCloser(backdrop, (event) => {
                const closeFnName = backdrop.dataset.backdropClose;
                const closeFn = globalScope[closeFnName];
                if (typeof closeFn === 'function') {
                    closeFn(event);
                }
            });
        });
    }

    const api = {
        shouldCloseModalBackdrop,
        installSafeBackdropCloser,
        attachSafeBackdropClosers
    };

    globalScope.ModalBackdrop = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
