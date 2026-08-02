/**
 * #page-projects — master/detail over the project listing.
 *
 * This is the first page rendered from React state instead of from innerHTML
 * strings written by `legacy/app.ts`. The controller keeps owning the data
 * (it fetches, opens, deletes); it publishes into `state/projects` and this
 * component is the only thing that paints it.
 */

import { App } from '../legacy/app';
import { useProjects } from '../state/projects';

const FolderIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
);

const GridIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18"></rect>
    <path d="M3 9h18M9 21V9"></path>
  </svg>
);

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-text">{text}</div>
    </div>
  );
}

/** The dashed "new project" card that closes the list. */
function NewProjectCard() {
  return (
    <div
      className="project-row project-row-new"
      onClick={() => App.openNewProjectChoiceModal()}
      tabIndex={0}
      role="button"
      aria-label="Vytvořit nový projekt"
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        border: '1px dashed var(--border-light)',
        background: 'transparent',
        padding: '12px',
        marginTop: '10px',
        marginBottom: '4px',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--text-light)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        {App.t('lbl.newProjectCard')}
      </div>
    </div>
  );
}

/** One row of the list. Click selects, double click / Enter opens. */
function ProjectRow({ p, selected, open, opening }: { p: any; selected: boolean; open: boolean; opening: boolean }) {
  const robot = (p.robots && p.robots.length) ? p.robots[0] : null;
  const rt = App.robotTypeLabel(robot ? (robot.type || robot.follower_type || '') : '');
  const path = p._path || '';
  const cls = ['project-row', selected && 'selected', open && 'open', opening && 'opening']
    .filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => App.selectProject(path)}
      onDoubleClick={() => App.openProject(path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') App.openProject(path);
        else if (e.key === ' ') { e.preventDefault(); App.selectProject(path); }
      }}
      data-path={path}
    >
      <div className="project-row-head">
        <span className="project-row-name">{p.name}</span>
        {open ? <span className="project-row-flag">{App.t('val.projectOpen')}</span> : null}
      </div>
      <div className="project-row-meta">
        <span className={`robot-badge ${rt.cls}`}>{rt.label}</span>
      </div>
    </div>
  );
}

/** Small key/value row of the detail panel. */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="pd-row">
      <span className="pd-key">{label}</span>
      <span className={mono ? 'pd-val mono' : 'pd-val'}>{value || '—'}</span>
    </div>
  );
}

function Stat({ value, label, warn }: { value: number | string; label: string; warn?: boolean }) {
  return (
    <div className={warn ? 'pd-stat warn' : 'pd-stat'}>
      <span className="pd-stat-num">{String(value)}</span>
      <span className="pd-stat-label">{label}</span>
    </div>
  );
}

/**
 * Everything about the selected project that is knowable from its
 * project.json and skills/ directory — i.e. without opening it.
 */
function ProjectDetail({ p }: { p: any }) {
  const robots: any[] = p.robots || [];
  const cameras: any[] = p.cameras || [];
  const tasks = App.projectTaskTree(p);
  const splittable = tasks.filter(t => t.steps.length >= 2);
  const created = p.created_at ? new Date(p.created_at).toLocaleString() : '';

  return (
    <>
      <div className="pd-ident">
        <div className="pd-title">{p.name}</div>
        <div className="pd-sub mono">{p._path || ''}</div>
      </div>

      <div className="pd-stats">
        <Stat value={robots.length} label={App.t('val.robots')} warn={robots.length === 0} />
        <Stat value={cameras.length} label={App.t('val.cameras')} />
        <Stat value={tasks.length} label={App.t('val.tasks')} />
        <Stat value={splittable.length} label={App.t('val.splittable')} />
      </div>

      <div className="pd-cols">
        <div className="pd-col">
          <section className="pd-sect">
            <h4 className="pd-h">{App.t('blk.pd.identity')}</h4>
            <DetailRow label={App.t('lbl.slug')} value={p.slug || ''} mono />
            <DetailRow label={App.t('lbl.created')} value={created} />
            <DetailRow label={App.t('lbl.policyArch')} value={p.policy_architecture || ''} />
          </section>

          <section className="pd-sect">
            <h4 className="pd-h">{App.t('blk.pd.scene')}</h4>
            {p.scene_description
              ? <p className="pd-scene">{p.scene_description}</p>
              : <p className="pd-scene warn">{App.t('warn.noSceneDesc')}</p>}
          </section>
        </div>

        <section className="pd-sect">
          <h4 className="pd-h">{App.t('blk.pd.hardware')}</h4>
          <table className="pd-table">
            <thead>
              <tr>
                <th>{App.t('lbl.device')}</th>
                <th>{App.t('lbl.id')}</th>
                <th>{App.t('lbl.port')}</th>
              </tr>
            </thead>
            <tbody>
              {robots.length ? robots.map((r, i) => {
                const rt = App.robotTypeLabel(r.type || r.follower_type || '');
                return (
                  <tr key={i}>
                    <td><span className={`robot-badge ${rt.cls}`}>{rt.label}</span></td>
                    <td className="mono">{r.id || '—'}</td>
                    <td className="mono">{r.port || r.device_id || '—'}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={3} className="pd-none">{App.t('val.noRobots')}</td></tr>
              )}
            </tbody>
          </table>
          <table className="pd-table">
            <thead>
              <tr>
                <th>{App.t('lbl.camera')}</th>
                <th>{App.t('lbl.role')}</th>
                <th>{App.t('lbl.resFps')}</th>
              </tr>
            </thead>
            <tbody>
              {cameras.length ? cameras.map((c, i) => (
                <tr key={i}>
                  <td className="mono">{c.id || '—'}</td>
                  <td>{c.role || '—'}</td>
                  <td className="mono">{`${Array.isArray(c.resolution) ? c.resolution.join('×') : '—'} @ ${c.fps ?? '—'}`}</td>
                </tr>
              )) : (
                <tr><td colSpan={3} className="pd-none">{App.t('val.noCameras')}</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="pd-sect">
        <h4 className="pd-h">{App.t('blk.pd.tasks')}</h4>
        <p className="pd-note">{App.t('hint.splitRule')}</p>
        {tasks.length ? tasks.map(t => {
          const ok = t.steps.length >= 2;
          return (
            <div className="pd-task" key={t.slug}>
              <div className="pd-task-head">
                <span className="pd-task-name">{t.name}</span>
                <span className={`pd-task-mode ${ok ? 'ok' : 'baseline'}`}>
                  {App.t(ok ? 'val.modeBoth' : 'val.modeBaseline')}
                </span>
              </div>
              <div className="pd-task-steps">
                {t.steps.length
                  ? t.steps.map((s: any, i: number) => (
                      <span className="pd-step" key={s.slug ?? i}>
                        <span className="pd-step-num">{i + 1}</span>{s.name || s.slug}
                      </span>
                    ))
                  : <span className="pd-none">{App.t('val.noSubSteps')}</span>}
              </div>
            </div>
          );
        }) : <div className="pd-none">{App.t('val.noTasks')}</div>}
      </section>
    </>
  );
}

export function ProjectsPage() {
  const { projects, selectedPath, openPath, openingPath, loaded } = useProjects();
  const selected = projects.find(p => p._path === selectedPath);
  const selectedIsOpen = !!(openPath && selectedPath === openPath);
  const opening = !!openingPath && openingPath === selectedPath;

  return (
    <div id="page-projects" className="editor-area active-page">
      <div className="page-header-row">
        <h2 data-i18n="page.projects.title">Správa Projektů</h2>
      </div>
      {/* Master/detail: the list picks a project, the right panel says everything about it that can be known without opening it. Both panels own their own actions in .block-actions footers. */}
      <div className="setup-section projects-section">
        <div className="setup-block">
          <div className="block-head-row">
            <h3 style={{ margin: "0" }}>
              <FolderIcon size={14} />
              {' '}
              <span data-i18n="blk.projects">Projekty</span>
            </h3>
            <span className="block-head-sub" id="project-list-count">
              {loaded ? `${projects.length} ${App.t('val.projectsShort')}` : ''}
            </span>
          </div>
          <div className="setup-block-content">
            <div className="project-list" id="project-list">
              {!loaded ? (
                <EmptyState icon={<FolderIcon size={24} />} text={App.t('hint.loadingProjects')} />
              ) : !projects.length ? (
                <>
                  <EmptyState icon={<FolderIcon size={24} />} text={App.t('hint.noProjects')} />
                  <NewProjectCard />
                </>
              ) : (
                <>
                  {projects.map(p => (
                    <ProjectRow
                      key={p._path}
                      p={p}
                      selected={p._path === selectedPath}
                      open={!!(openPath && p._path === openPath)}
                      opening={!!(openingPath && p._path === openingPath)}
                    />
                  ))}
                  <NewProjectCard />
                </>
              )}
            </div>
          </div>
          <div className="block-actions">
            <button
              className="btn btn-xs btn-secondary"
              data-i18n="btn.importBundle"
              onClick={() => { App.importProjectBundle() }}
              data-i18n-title="tip.importBundle"
              title="Importovat .orchiday balíček (projekt + datasety + modely)"
            >Importovat balíček</button>
          </div>
        </div>
        {/* /left: project list */}
        <div className="setup-block">
          <div className="block-head-row">
            <h3 style={{ margin: "0" }}>
              <GridIcon size={14} />
              {' '}
              <span data-i18n="blk.projectDetail">Detail projektu</span>
            </h3>
            <span className="block-head-sub" id="project-detail-state">
              {selected ? App.t(selectedIsOpen ? 'val.projectOpen' : 'val.projectClosed') : ''}
            </span>
          </div>
          <div className="setup-block-content">
            <div className="project-detail" id="project-detail">
              {selected
                ? <ProjectDetail p={selected} />
                : <EmptyState icon={<GridIcon size={24} />} text={App.t('hint.projectDetailEmpty')} />}
            </div>
          </div>
          <div className="block-actions">
            {/* Export runs over the *open* project server-side, so the hint says
                so instead of letting a disabled button look broken. */}
            <span className="block-actions-hint" id="project-detail-hint">
              {!selected
                ? App.t('hint.projectDetail')
                : App.t(selectedIsOpen ? 'hint.projectDetailOpen' : 'hint.projectDetailClosed')}
            </span>
            {' '}
            <button
              className="btn btn-xs btn-danger"
              id="btn-project-delete"
              data-i18n="btn.deleteProject"
              onClick={() => { App.deleteSelectedProject() }}
              data-i18n-title="tip.deleteProject"
              title="Nevratně smaže adresář vybraného projektu včetně dovedností a kalibrací"
              disabled={!selected}
            >Smazat projekt</button>
            {' '}
            <button
              className="btn btn-xs btn-secondary"
              id="btn-project-export"
              data-i18n="btn.exportBundle"
              onClick={() => { App.showExportModal() }}
              data-i18n-title="tip.exportBundle"
              title="Exportovat aktuální projekt jako přenositelný .orchiday balíček"
              disabled={!selected || !selectedIsOpen}
            >Exportovat balíček</button>
            {' '}
            <button
              className="btn btn-xs btn-primary"
              id="btn-project-open"
              onClick={() => { App.openSelectedProject() }}
              data-i18n-title="tip.openProject"
              title="Načte projekt: nasadí jeho kalibrační soubory do cache LeRobotu a odemkne ostatní stránky"
              disabled={!selected || selectedIsOpen || opening}
            >{opening ? App.t('btn.opening') : App.t('btn.openProject')}</button>
          </div>
        </div>
        {/* /right: project detail */}
      </div>
    </div>
  );
}
