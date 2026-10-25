/**
 * ============================================
 * COLLABORATION UI FUNCTIONS - PART 2
 * ============================================
 * Link-based sharing, comments, versions, and team management
 */

// ============================================
// LINK-BASED SHARING (Backend Required)
// ============================================

async function generateBackendShareLink() {
    const suiteId = document.getElementById('link-share-suite-selector').value;
    const expiresInDays = parseInt(document.getElementById('share-expiry-days').value);

    if (!suiteId) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please select a test suite', 'warning');
        }
        return;
    }

    const suite = window.testSuites.find(s => s.id === suiteId);
    if (!suite) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Test suite not found', 'error');
        }
        return;
    }

    try {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Generating share link...', 'info');
        }

        const result = await window.collaborationManager.generateShareableLink(suite, expiresInDays);

        showShareLinkModal(result, suite.name);

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Failed to generate share link: ' + error.message, 'error');
        }
    }
}

function showShareLinkModal(result, suiteName) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[70] flex items-center justify-center aero-modal-backdrop';
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
            refreshBackendShares();
        }
    };

    modal.innerHTML = `
    <div class='aero-modal p-6 max-w-2xl' onclick='event.stopPropagation()'>
      <h3 class='text-xl font-bold mb-4 aero-text-primary'>${window.LVXIcons?.svg("link") || ''} Share Link Generated!</h3>

      <div class='aero-glass-panel p-4 rounded-lg mb-4 border-l-4 border-green-500'>
        <div class='font-semibold mb-2'>${suiteName}</div>
        <div class='text-sm aero-text-muted mb-3'>
          Anyone with this link can import your test suite.
        </div>

        <label class='block text-xs font-semibold aero-text-secondary mb-2'>Shareable URL</label>
        <div class='flex gap-2 mb-3'>
          <input type='text' value='${result.shareUrl}' readonly id='generated-share-url'
            class='flex-1 aero-input p-2 rounded-lg font-mono text-xs'>
          <button onclick='copyGeneratedShareUrl()'
            class='aero-button-info px-3 py-2 rounded whitespace-nowrap hover:bg-blue-600 transition'>
            ${window.LVXIcons?.svg("file") || ''} Copy
          </button>
        </div>

        <div class='text-xs aero-text-muted'>
          Expires: ${new Date(result.expiresAt).toLocaleDateString()} at ${new Date(result.expiresAt).toLocaleTimeString()}
        </div>
      </div>

      <div class='aero-glass-panel p-3 rounded-lg mb-4 border-l-4 border-blue-500'>
        <p class='text-sm aero-text-muted'>
          <strong>${window.LVXIcons?.svg("info") || ''} Tip:</strong> Share this link via email, Slack, or any messaging app. The link will work in any browser!
        </p>
      </div>

      <button onclick='this.closest(".aero-modal-backdrop").remove(); refreshBackendShares()'
        class='aero-button-success px-4 py-2 rounded-lg w-full font-semibold hover:bg-green-600 transition'>
        Done
      </button>
    </div>
  `;

    document.body.appendChild(modal);
}

function copyGeneratedShareUrl() {
    const input = document.getElementById('generated-share-url');
    if (input) {
        input.select();
        document.execCommand('copy');
        if (typeof window.showMessage === 'function') {
            window.showMessage('Share URL copied to clipboard!', 'success');
        }
    }
}

async function importFromLink() {
    const linkInput = document.getElementById('import-share-link').value.trim();
    if (!linkInput) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please enter a share link', 'warning');
        }
        return;
    }

    let shareId = linkInput;
    const match = linkInput.match(/import=([a-z0-9]+)/i);
    if (match) {
        shareId = match[1];
    }

    await importFromSharedLink(shareId);
}

async function importFromSharedLink(shareId) {
    if (!shareId) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Invalid share link', 'error');
        }
        return;
    }

    try {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Importing test suite...', 'info');
        }

        const source = await window.collaborationManager.importFromBackendShareLink(shareId);
        const suite = window.collaborationManager.prepareImportedSuite(source);
        await window.collaborationManager.persistImportedSuites([suite]);

        if (typeof window.showMessage === 'function') {
            window.showMessage(`Successfully imported: ${suite.name}`, 'success');
        }
        closeCollaborationModal();

        if (window.location.hash.includes('import=')) {
            history.replaceState(null, '', window.location.pathname);
        }

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Import failed: ' + error.message, 'error');
        }
    }
}

async function refreshBackendShares() {
    if (!window.collaborationManager.isBackendConfigured()) {
        return;
    }

    const container = document.getElementById('backend-shared-links-list');
    if (!container) return;

    container.innerHTML = '<p class="text-sm aero-text-muted">Loading...</p>';

    try {
        const shares = await window.collaborationManager.getBackendSharedLinks();
        renderBackendShares(shares);
    } catch (error) {
        container.innerHTML = `<p class="text-sm aero-text-danger">Failed to load: ${error.message}</p>`;
    }
}

function refreshBackendSharesIfConfigured() {
    if (window.collaborationManager.isBackendConfigured()) {
        refreshBackendShares();
    }
}

function renderBackendShares(shares) {
    const container = document.getElementById('backend-shared-links-list');
    if (!container) return;

    if (shares.length === 0) {
        container.innerHTML = '<p class="text-sm aero-text-muted">No active shared links yet. Generate one above!</p>';
        return;
    }

    container.innerHTML = shares.map(share => {
        const isExpired = new Date(share.expiresAt) < new Date();
        const shareUrl = share.shareUrl || `${window.location.origin}${window.location.pathname}#import=${share.shareId}`;

        return `
      <div class='aero-button p-3 rounded-lg ${isExpired ? 'opacity-60' : ''}'>
        <div class='flex justify-between items-start mb-2'>
          <div class='flex-1'>
            <div class='font-semibold'>${share.suiteName}</div>
            <div class='text-xs aero-text-muted'>
              Created: ${new Date(share.createdAt).toLocaleDateString()} |
              Expires: ${new Date(share.expiresAt).toLocaleDateString()}
              ${share.accessCount ? ` | Accessed: ${share.accessCount} times` : ''}
            </div>
            ${isExpired ? `<div class="text-xs aero-text-danger font-semibold mt-1">${window.LVXIcons?.svg("warning") || ''} EXPIRED</div>` : ''}
          </div>
          <button onclick='revokeBackendShareLink("${share.shareId}")'
            class='aero-button-danger text-sm py-1 px-2 rounded hover:bg-red-600 transition'>
            ${window.LVXIcons?.svg("trash") || ''}
          </button>
        </div>
        <div class='text-xs font-mono aero-input p-2 rounded break-all bg-gray-50'>
          ${shareUrl}
        </div>
      </div>
    `;
    }).join('');
}

async function revokeBackendShareLink(shareId) {
    if (!confirm('Revoke this share link?\n\nThe link will no longer work for importing.')) {
        return;
    }

    try {
        await window.collaborationManager.revokeBackendShareLink(shareId);
        if (typeof window.showMessage === 'function') {
            window.showMessage('Share link revoked', 'success');
        }
        refreshBackendShares();
    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Failed to revoke: ' + error.message, 'error');
        }
    }
}

// ============================================
// COMMENTS
// ============================================

function loadSuiteComments() {
    const suiteId = document.getElementById('comment-suite-selector').value;
    renderComments(suiteId);
}

function renderComments(suiteId = null) {
    const container = document.getElementById('comments-list');
    if (!container) return;

    if (!suiteId) {
        container.innerHTML = '<p class="text-sm aero-text-muted">Select a test suite to view comments</p>';
        return;
    }

    const comments = window.collaborationManager.getSuiteComments(suiteId);

    if (comments.length === 0) {
        container.innerHTML = '<p class="text-sm aero-text-muted">No comments yet. Add one above to get started!</p>';
        return;
    }

    container.innerHTML = comments.map(comment => `
    <div class='aero-glass-panel p-4 rounded-lg'>
      <div class='flex justify-between items-start mb-2'>
        <div class='flex items-center gap-3'>
          <div class='w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center font-bold text-sm'>
            ${comment.user.charAt(0).toUpperCase()}
          </div>
          <div>
            <div class='font-semibold text-sm'>${comment.user}</div>
            <div class='text-xs aero-text-muted'>
              ${new Date(comment.timestamp).toLocaleString()}
              ${comment.edited ? ' • <span class="italic">edited</span>' : ''}
            </div>
          </div>
        </div>
        ${comment.user === window.collaborationManager.getCurrentUser() ? `
          <div class='flex gap-1'>
            <button onclick='editCommentById("${comment.id}")'
              class='aero-button-warning text-xs py-1 px-2 rounded hover:bg-yellow-600 transition'
              title='Edit comment'>
              ${window.LVXIcons?.svg("edit") || ''}
            </button>
            <button onclick='deleteCommentById("${comment.id}")'
              class='aero-button-danger text-xs py-1 px-2 rounded hover:bg-red-600 transition'
              title='Delete comment'>
              ${window.LVXIcons?.svg("trash") || ''}
            </button>
          </div>
        ` : ''}
      </div>
      <div class='text-sm whitespace-pre-wrap' id='comment-text-${comment.id}'>${comment.text}</div>
    </div>
  `).join('');
}

function addComment() {
    const suiteId = document.getElementById('comment-suite-selector').value;
    const text = document.getElementById('comment-input').value.trim();

    if (!suiteId) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please select a test suite', 'warning');
        }
        return;
    }

    if (!text) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please enter a comment', 'warning');
        }
        return;
    }

    try {
        window.collaborationManager.addComment(suiteId, text);
        document.getElementById('comment-input').value = '';
        renderComments(suiteId);
        if (typeof window.showMessage === 'function') {
            window.showMessage('Comment added', 'success');
        }
    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('' + error.message, 'error');
        }
    }
}

function editCommentById(commentId) {
    const textElement = document.getElementById(`comment-text-${commentId}`);
    if (!textElement) return;

    const currentText = textElement.textContent;
    window.showInputModal('Edit your comment:', currentText, (newText) => {
        if (newText && newText.trim() && newText !== currentText) {
            try {
                window.collaborationManager.editComment(commentId, newText);
                const suiteId = document.getElementById('comment-suite-selector').value;
                renderComments(suiteId);
                if (typeof window.showMessage === 'function') {
                    window.showMessage('Comment updated', 'success');
                }
            } catch (error) {
                if (typeof window.showMessage === 'function') {
                    window.showMessage('' + error.message, 'error');
                }
            }
        }
    });
}

function deleteCommentById(commentId) {
    if (confirm('Delete this comment?')) {
        try {
            window.collaborationManager.deleteComment(commentId);
            const suiteId = document.getElementById('comment-suite-selector').value;
            renderComments(suiteId);
            if (typeof window.showMessage === 'function') {
                window.showMessage('Comment deleted', 'success');
            }
        } catch (error) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('' + error.message, 'error');
            }
        }
    }
}

// ============================================
// VERSIONS
// ============================================

async function loadVersionHistory() {
    const suiteId = document.getElementById('version-suite-selector').value;
    await renderVersionHistory(suiteId);
}

const escapeCollaborationVersion=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let collaborationVersionRender=0;
async function renderVersionHistory(suiteId = null) {
    const renderToken=++collaborationVersionRender;
    const container = document.getElementById('collab-versions-list');
    if (!container) return;

    if (!suiteId) {
        container.innerHTML = '<p class="text-sm aero-text-muted">Select a test suite to view version history</p>';
        return;
    }

    let versions;try{versions=await window.collaborationManager.getVersionHistory(suiteId);}catch(error){if(renderToken===collaborationVersionRender){container.textContent='Version history could not be loaded: '+error.message;container.setAttribute('role','alert');}return;}
    if(renderToken!==collaborationVersionRender)return;container.removeAttribute('role');

    if (versions.length === 0) {
        container.innerHTML = '<p class="text-sm aero-text-muted">No version snapshots yet. Create one above!</p>';
        return;
    }

    const sortedVersions = [...versions].reverse();

    container.innerHTML = sortedVersions.map((version, index) => `
    <div class='aero-button p-3 rounded-lg'>
      <div class='flex justify-between items-start mb-2'>
        <div class='flex-1'>
          <div class='flex items-center gap-2 mb-1'>
            <span class='font-semibold'>Version ${escapeCollaborationVersion(version.version)}</span>
            ${index === 0 ? '<span class="aero-badge-info text-xs">Latest</span>' : ''}
          </div>
          <div class='text-sm aero-text-muted mb-1'>${escapeCollaborationVersion(version.description)}</div>
          <div class='text-xs aero-text-muted'>
            Created by ${escapeCollaborationVersion(version.createdBy)} on ${new Date(version.createdAt).toLocaleString()}
          </div>
        </div>
        <button data-restore-version="${escapeCollaborationVersion(version.id)}"
          class='aero-button-warning py-2 px-3 rounded hover:bg-yellow-600 transition whitespace-nowrap'
          title='Restore this version'>
          ${window.LVXIcons?.svg("undo") || ''} Restore
        </button>
      </div>
    </div>
  `).join('');
    container.querySelectorAll('[data-restore-version]').forEach(button=>button.addEventListener('click',()=>restoreVersionById(button.dataset.restoreVersion)));
}

async function createVersionSnapshot() {
    const suiteId = document.getElementById('version-suite-selector').value;
    const description = document.getElementById('version-description').value.trim();

    if (!suiteId) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please select a test suite', 'warning');
        }
        return;
    }

    const suite = window.testSuites.find(s => s.id === suiteId);
    if (!suite) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Test suite not found', 'error');
        }
        return;
    }

    try {
        const snapshot = await window.collaborationManager.createVersionSnapshot(suite, description);
        document.getElementById('version-description').value = '';
        await renderVersionHistory(suiteId);
        if (typeof window.showMessage === 'function') {
            window.showMessage(`Version ${snapshot.version} created successfully!`, 'success');
        }
    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('' + error.message, 'error');
        }
    }
}

async function restoreVersionById(versionId) {
    if (!confirm('Restore this version?\n\n The current version will be replaced. Consider creating a snapshot first!')) {
        return;
    }

    try {
        const restoredSuite = await window.collaborationManager.restoreVersion(versionId);

        const index = window.testSuites.findIndex(s => s.id === restoredSuite.id);
        if (index >= 0) {
            await window.collaborationManager.persistRestoredSuite(restoredSuite);
            if (typeof window.showMessage === 'function') {
                window.showMessage('Version restored successfully!', 'success');
            }
            closeCollaborationModal();
        } else {
            if (typeof window.showMessage === 'function') {
                window.showMessage('Test suite not found', 'error');
            }
        }
    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Failed to restore: ' + error.message, 'error');
        }
    }
}

// ============================================
// TEAM MEMBERS
// ============================================

function renderTeamMembers() {
    const container = document.getElementById('team-members-list');
    if (!container) return;

    const team = window.collaborationManager.getTeamMembers();

    if (team.length === 0) {
        container.innerHTML = '<p class="text-sm aero-text-muted">No team members yet. Add one above!</p>';
        return;
    }

    container.innerHTML = team.map(member => `
    <div class='aero-button p-3 rounded-lg'>
      <div class='flex justify-between items-center'>
        <div class='flex items-center gap-3'>
          <div class='w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-teal-500 text-white flex items-center justify-center font-bold text-lg'>
            ${member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div class='font-semibold'>${member.name}</div>
            <div class='text-xs aero-text-muted'>
              ${member.email || 'No email'} • ${member.role}
            </div>
            <div class='text-xs aero-text-muted'>
              Added ${new Date(member.addedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <button onclick='removeTeamMemberById("${member.id}")'
          class='aero-button-danger py-2 px-3 rounded hover:bg-red-600 transition'>
          ${window.LVXIcons?.svg("trash") || ''} Remove
        </button>
      </div>
    </div>
  `).join('');
}

function addTeamMember() {
    const name = document.getElementById('team-member-name').value.trim();
    const email = document.getElementById('team-member-email').value.trim();
    const role = document.getElementById('team-member-role').value;

    if (!name) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please enter a name', 'warning');
        }
        return;
    }

    try {
        window.collaborationManager.addTeamMember({ name, email, role });

        document.getElementById('team-member-name').value = '';
        document.getElementById('team-member-email').value = '';
        document.getElementById('team-member-role').value = 'member';

        renderTeamMembers();
        if (typeof window.showMessage === 'function') {
            window.showMessage(`${name} added to team`, 'success');
        }
    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('' + error.message, 'error');
        }
    }
}

function removeTeamMemberById(memberId) {
    if (confirm('Remove this team member from your local list?')) {
        try {
            window.collaborationManager.removeTeamMember(memberId);
            renderTeamMembers();
            if (typeof window.showMessage === 'function') {
                window.showMessage('Team member removed', 'success');
            }
        } catch (error) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('' + error.message, 'error');
            }
        }
    }
}

// ============================================
// EXPORT ALL FUNCTIONS
// ============================================

window.generateBackendShareLink = generateBackendShareLink;
window.copyGeneratedShareUrl = copyGeneratedShareUrl;
window.importFromLink = importFromLink;
window.importFromSharedLink = importFromSharedLink;
window.refreshBackendShares = refreshBackendShares;
window.revokeBackendShareLink = revokeBackendShareLink;
window.loadSuiteComments = loadSuiteComments;
window.addComment = addComment;
window.editCommentById = editCommentById;
window.deleteCommentById = deleteCommentById;
window.loadVersionHistory = loadVersionHistory;
window.createVersionSnapshot = createVersionSnapshot;
window.restoreVersionById = restoreVersionById;
window.renderTeamMembers = renderTeamMembers;
window.addTeamMember = addTeamMember;
window.removeTeamMemberById = removeTeamMemberById;

// ============================================
// BULK TEAM MEMBER IMPORT (NEW)
// ============================================

function importTeamMembersCSV() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
            try {
                const csvData = event.target.result;
                const lines = csvData.split('\n').filter(line => line.trim());

                // Skip header if it looks like a header
                const startIndex = lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('email') ? 1 : 0;

                let successCount = 0;
                let failCount = 0;
                const errors = [];

                for (let i = startIndex; i < lines.length; i++) {
                    const parts = lines[i].split(',').map(p => p.trim());
                    if (parts.length >= 1 && parts[0]) {
                        try {
                            const member = {
                                name: parts[0],
                                email: parts[1] || '',
                                role: parts[2] || 'member'
                            };
                            window.collaborationManager.addTeamMember(member);
                            successCount++;
                        } catch (error) {
                            failCount++;
                            errors.push(`Line ${i + 1}: ${error.message}`);
                        }
                    }
                }

                renderTeamMembers();

                if (typeof window.showMessage === 'function') {
                    if (successCount > 0) {
                        window.showMessage(
                            `Imported ${successCount} team members` +
                            (failCount > 0 ? `\n ${failCount} failed` : ''),
                            successCount > failCount ? 'success' : 'warning'
                        );
                    } else {
                        window.showMessage('No team members imported', 'error');
                    }
                }
            } catch (error) {
                if (typeof window.showMessage === 'function') {
                    window.showMessage('Failed to parse CSV: ' + error.message, 'error');
                }
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function showBulkAddTeamModal() {
    const modal = document.createElement('div');
    modal.id = 'bulk-add-team-modal';
    modal.className = 'fixed inset-0 z-[70] flex items-center justify-center aero-modal-backdrop';
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };

    modal.innerHTML = `
    <div class='aero-modal p-6 max-w-2xl' onclick='event.stopPropagation()'>
      <h3 class='text-xl font-bold mb-4 aero-text-primary'>${window.LVXIcons?.svg("plus") || ''} Bulk Add Team Members</h3>

      <div class='aero-glass-panel p-4 rounded-lg mb-4 border-l-4 border-blue-500'>
        <h4 class='font-semibold aero-text-primary mb-2'>${window.LVXIcons?.svg("info") || ''} How to add multiple members</h4>
        <p class='text-sm aero-text-muted mb-2'>Enter one team member per line in the format:</p>
        <code class='block aero-input p-2 rounded text-xs mb-2'>Name, Email, Role</code>
        <p class='text-xs aero-text-muted'>Example: John Doe, john@example.com, qa</p>
      </div>

      <textarea id='bulk-team-input' rows='8'
        class='w-full aero-input p-3 rounded-lg font-mono text-sm mb-4'
        placeholder='John Doe, john@example.com, qa
Jane Smith, jane@example.com, dev
Bob Wilson, bob@example.com, lead'></textarea>

      <div class='flex gap-3 mb-4'>
        <button onclick='importTeamMembersCSV()'
          class='aero-button-info px-4 py-2 rounded-lg flex-1 hover:bg-blue-600 transition'>
          ${window.LVXIcons?.svg("folder") || ''} Import from CSV File
        </button>
        <button onclick='processBulkTeamAdd()'
          class='aero-button-success px-4 py-2 rounded-lg flex-1 hover:bg-green-600 transition'>
          ${window.LVXIcons?.svg("plus") || ''} Add All Members
        </button>
      </div>

      <button onclick='document.getElementById(\"bulk-add-team-modal\").remove()'
        class='aero-button-gray px-4 py-2 rounded-lg w-full hover:bg-gray-400 transition'>
        Cancel
      </button>
    </div>
  `;

    document.body.appendChild(modal);
}

function processBulkTeamAdd() {
    const textarea = document.getElementById('bulk-team-input');
    if (!textarea) return;

    const lines = textarea.value.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please enter at least one team member', 'warning');
        }
        return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 1 && parts[0]) {
            try {
                const member = {
                    name: parts[0],
                    email: parts[1] || '',
                    role: parts[2] || 'member'
                };
                window.collaborationManager.addTeamMember(member);
                successCount++;
            } catch (error) {
                failCount++;
            }
        }
    }

    renderTeamMembers();

    if (typeof window.showMessage === 'function') {
        if (successCount > 0) {
            window.showMessage(
                `Added ${successCount} team members` +
                (failCount > 0 ? `\n ${failCount} failed (duplicates or invalid)` : ''),
                successCount > failCount ? 'success' : 'warning'
            );
        }
    }

    const modal = document.getElementById('bulk-add-team-modal');
    if (modal) modal.remove();
}

// ============================================
// EMAIL SHARING (NEW)
// ============================================

async function emailTestSuite() {
    const suiteId = document.getElementById('file-export-suite-selector').value;
    if (!suiteId) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please select a test suite', 'warning');
        }
        return;
    }

    const suite = window.testSuites.find(s => s.id === suiteId);
    if (!suite) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Test suite not found', 'error');
        }
        return;
    }

    const includeHistory = document.getElementById('export-include-history').checked;

    try {
        const result = await window.collaborationManager.exportForTeam(suite, includeHistory);

        // Show team member selection modal
        showEmailRecipientModal(result, suite.name);

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Export failed: ' + error.message, 'error');
        }
    }
}

function showEmailRecipientModal(exportResult, suiteName) {
    const team = window.collaborationManager.getTeamMembers();

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[70] flex items-center justify-center aero-modal-backdrop';
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };

    modal.innerHTML = `
    <div class='aero-modal p-6 max-w-2xl' onclick='event.stopPropagation()'>
      <h3 class='text-xl font-bold mb-4 aero-text-primary'>${window.LVXIcons?.svg("mail") || ''} Email Test Suite</h3>

      <div class='aero-glass-panel p-4 rounded-lg mb-4 border-l-4 border-blue-500'>
        <div class='font-semibold mb-1'>${suiteName}</div>
        <div class='text-xs aero-text-muted'>
          File: ${exportResult.filename} (${(exportResult.size / 1024).toFixed(2)} KB)
        </div>
      </div>

      ${team.length > 0 ? `
        <div class='aero-glass-panel p-4 rounded-lg mb-4'>
          <h4 class='font-semibold aero-text-secondary mb-3'>Select Recipients</h4>
          <div class='space-y-2 max-h-60 overflow-y-auto'>
            ${team.filter(m => m.email).map(member => `
              <label class='flex items-center gap-2 p-2 hover:bg-gray-100 rounded cursor-pointer'>
                <input type='checkbox' class='email-recipient-checkbox' value='${member.email}' />
                <div class='flex-1'>
                  <div class='font-semibold text-sm'>${member.name}</div>
                  <div class='text-xs aero-text-muted'>${member.email}</div>
                </div>
              </label>
            `).join('')}
          </div>
          ${team.filter(m => !m.email).length > 0 ? `
            <p class='text-xs aero-text-muted mt-2'>
              ${window.LVXIcons?.svg("warning") || ''} ${team.filter(m => !m.email).length} team members don't have email addresses
            </p>
          ` : ''}
        </div>
      ` : `
        <div class='aero-glass-panel p-4 rounded-lg mb-4 text-center'>
          <p class='text-sm aero-text-muted'>No team members with email addresses found.</p>
          <p class='text-xs aero-text-muted mt-2'>Add team members in the Team tab first.</p>
        </div>
      `}

      <div class='mb-4'>
        <label class='block text-sm font-medium aero-text-secondary mb-2'>Or enter email address manually:</label>
        <input type='email' id='manual-email-input'
          class='w-full aero-input p-2 rounded-lg'
          placeholder='recipient@example.com'>
      </div>

      <div class='flex gap-3'>
        <button onclick='this.closest(".aero-modal-backdrop").remove()'
          class='aero-button-gray px-4 py-2 rounded-lg flex-1 hover:bg-gray-400 transition'>
          Cancel
        </button>
        <button data-action='send-export-email'
          class='aero-button-success px-4 py-2 rounded-lg flex-1 font-semibold hover:bg-green-600 transition'>
          ${window.LVXIcons?.svg("mail") || ''} Send Email
        </button>
      </div>
    </div>
  `;

    modal.querySelector('[data-action=send-export-email]').addEventListener('click', () => sendEmailWithFile(exportResult, suiteName));
    document.body.appendChild(modal);
    return modal;
}

async function sendEmailWithFile(exportResult, suiteName) {
    const checkboxes = document.querySelectorAll('.email-recipient-checkbox:checked');
    const manualEmail = document.getElementById('manual-email-input')?.value.trim();

    const recipients = [];
    checkboxes.forEach(cb => recipients.push(cb.value));
    if (manualEmail) recipients.push(manualEmail);

    if (recipients.length === 0) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('Please select at least one recipient or enter an email', 'warning');
        }
        return;
    }

    // Try Web Share API first (mobile-friendly, can share actual file)
    if (navigator.share && navigator.canShare) {
        try {
            const file = new File([exportResult.blob], exportResult.filename, { type: 'application/json' });

            const shareData = {
                title: `Test Suite: ${suiteName}`,
                text: `Here's the test suite "${suiteName}" exported from LVX-Machina Test Manager.`,
                files: [file]
            };

            if (navigator.canShare(shareData)) {
                await navigator.share(shareData);
                if (typeof window.showMessage === 'function') {
                    window.showMessage('Share initiated!', 'success');
                }
                document.querySelector('.aero-modal-backdrop').remove();
                return;
            }
        } catch (error) {
            console.log('Web Share not available, falling back to mailto:', error);
        }
    }

    // Fallback to mailto (can't attach file, will provide download instructions)
    const subject = encodeURIComponent(`Test Suite: ${suiteName}`);
    const body = encodeURIComponent(
        `Hi,\n\n` +
        `I'm sharing a test suite with you from LVX-Machina Test Manager.\n\n` +
        `Test Suite: ${suiteName}\n` +
        `File: ${exportResult.filename}\n` +
        `Size: ${(exportResult.size / 1024).toFixed(2)} KB\n\n` +
        `To Import:\n` +
        `1. Download the attached JSON file (I'll send it separately or share via file sharing service)\n` +
        `2. Open LVX-Machina Test Manager\n` +
        `3. Click "Collaborate" → "Import/Export" tab\n` +
        `4. Click "Choose JSON File" and select the downloaded file\n\n` +
        `Best regards`
    );

    const mailtoLink = `mailto:${recipients.join(',')}?subject=${subject}&body=${body}`;

    // Also trigger download so user can attach it manually
    const url = URL.createObjectURL(exportResult.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportResult.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Open mailto
    window.location.href = mailtoLink;

    if (typeof window.showMessage === 'function') {
        window.showMessage(
            'File downloaded!\n\n Email client opening...\n\nPlease attach the downloaded file manually.',
            'info'
        );
    }

    setTimeout(() => {
        const modalBackdrop = document.querySelector('.aero-modal-backdrop');
        if (modalBackdrop) modalBackdrop.remove();
    }, 500);
}

// Export new functions
window.importTeamMembersCSV = importTeamMembersCSV;
window.showBulkAddTeamModal = showBulkAddTeamModal;
window.processBulkTeamAdd = processBulkTeamAdd;
window.emailTestSuite = emailTestSuite;
window.sendEmailWithFile = sendEmailWithFile;

console.log('Collaboration UI functions (Part 2) loaded');
