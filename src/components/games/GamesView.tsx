import type { Participant } from '../../App';

interface WheelSVGProps {
  spinParticipants: Participant[];
  angle: number;
  size: number;
  isExpanded: boolean;
  onSpin: () => void;
}

export function WheelSVG({
  spinParticipants,
  angle,
  size,
  isExpanded,
  onSpin
}: WheelSVGProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  const n = spinParticipants.length;
  const segmentAngle = n > 0 ? 360 / n : 360;

  return (
    <div className="wheel-outer-wrapper" style={{ width: size, height: size }}>
      <div className="wheel-pointer" style={{ top: isExpanded ? '-12px' : '-8px' }}>
        <svg width={isExpanded ? 28 : 20} height={isExpanded ? 28 : 20} viewBox="0 0 24 24" fill="var(--primary-color)" stroke="#fff" strokeWidth="2">
          <polygon points="12,24 4,8 20,8" />
        </svg>
      </div>

      {n > 0 ? (
        <svg 
          width={size} 
          height={size} 
          viewBox={`0 0 ${size} ${size}`} 
          style={{ 
            transform: `rotate(${angle}deg)`, 
            transition: 'transform 4s cubic-bezier(0.1, 0.8, 0.1, 1)' 
          }}
        >
          {spinParticipants.map((p, idx) => {
            const startAngle = idx * segmentAngle;
            const endAngle = (idx + 1) * segmentAngle;
            
            const x1 = cx + radius * Math.cos((startAngle - 90) * Math.PI / 180);
            const y1 = cy + radius * Math.sin((startAngle - 90) * Math.PI / 180);
            const x2 = cx + radius * Math.cos((endAngle - 90) * Math.PI / 180);
            const y2 = cy + radius * Math.sin((endAngle - 90) * Math.PI / 180);
            
            const largeArcFlag = segmentAngle > 180 ? 1 : 0;
            const pathData = `
              M ${cx} ${cy}
              L ${x1} ${y1}
              A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}
              Z
            `;
            
            const textAngle = startAngle + segmentAngle / 2;
            const textRadius = radius * 0.65;
            const tx = cx + textRadius * Math.cos((textAngle - 90) * Math.PI / 180);
            const ty = cy + textRadius * Math.sin((textAngle - 90) * Math.PI / 180);

            return (
              <g key={p.id}>
                <path d={pathData} fill={p.color || '#3b82f6'} stroke="rgba(0,0,0,0.15)" strokeWidth="1.5" />
                <text 
                  x={tx} 
                  y={ty} 
                  fill="#fff" 
                  fontSize={isExpanded ? 11 : 9} 
                  fontWeight="800" 
                  textAnchor="middle" 
                  transform={`rotate(${textAngle}, ${tx}, ${ty})`}
                >
                  {p.initials || p.name.substring(0, 2)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="wheel-empty-state">No participants checked</div>
      )}

      <button 
        type="button"
        onClick={onSpin} 
        className="wheel-center-button"
        style={{
          width: isExpanded ? '64px' : '44px',
          height: isExpanded ? '64px' : '44px',
          fontSize: isExpanded ? '12px' : '10px',
        }}
      >
        SPIN
      </button>
    </div>
  );
}

interface TruthOrDareUIProps {
  isExpanded: boolean;
  myId: string;
  callParticipants: Participant[];
  todActiveIds: string[];
  todPendingIds: string[];
  todSelectedId: string;
  todChoice: 'Truth' | 'Dare' | null;
  todText: string;
  todState: 'idle' | 'spinning' | 'choice' | 'reveal';
  todSpinResult: any;
  todLocalSpinning: boolean;
  todSpinPool: string[];
  handleSpinTruthOrDare: () => void;
  handleSelectTodChoice: (choice: 'Truth' | 'Dare') => void;
  handleResetTod: () => void;
  handleJoinTodGame: () => void;
  handleLeaveTodGame: () => void;
}

export function TruthOrDareUI({
  isExpanded,
  myId,
  callParticipants,
  todActiveIds,
  todPendingIds,
  todSelectedId,
  todChoice,
  todText,
  todState,
  todSpinResult,
  todLocalSpinning,
  todSpinPool,
  handleSpinTruthOrDare,
  handleSelectTodChoice,
  handleResetTod,
  handleJoinTodGame,
  handleLeaveTodGame
}: TruthOrDareUIProps) {
  const size = isExpanded ? 320 : 180;
  const myPresence = callParticipants.find(p => p.id === myId);
  const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

  const activeIds = todActiveIds.filter(id => callParticipants.some(p => p.id === id));
  const spinParticipants = callParticipants.filter(p => activeIds.includes(p.id));

  const canDecide = todSelectedId === myId || isHostOrAdmin || todActiveIds.includes(myId);

  return (
    <div className={`spinwheel-layout-container ${isExpanded ? 'expanded' : ''}`}>
      <div className="spinner-main-area" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        {/* Wheel rendering in IDLE or SPINNING state */}
        {(todState === 'idle' || todState === 'spinning') && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <WheelSVG
              spinParticipants={spinParticipants}
              angle={todSpinResult ? todSpinResult.angle : 0}
              size={size}
              isExpanded={isExpanded}
              onSpin={handleSpinTruthOrDare}
            />
            
            {todSpinResult && todState === 'idle' && !todLocalSpinning && (
              <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Spun by {todSpinResult.spunBy}
              </div>
            )}
          </div>
        )}

        {/* Choice phase */}
        {todState === 'choice' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px', padding: '16px 0' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Landed on</div>
            
            {(() => {
              const selectedUser = callParticipants.find(p => p.id === todSelectedId);
              const isMeSelected = myId === todSelectedId;
              
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="participant-avatar-large" style={{ backgroundColor: selectedUser?.color || '#3b82f6', width: '48px', height: '48px', border: '2px solid var(--primary-color)', position: 'relative', overflow: 'hidden' }}>
                      {selectedUser?.photoURL ? (
                        <img src={selectedUser.photoURL} alt={selectedUser.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                      ) : (
                        selectedUser?.initials || selectedUser?.name.substring(0, 2)
                      )}
                    </div>
                    <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary-color)' }}>
                      {selectedUser?.name.replace(' (You)', '') || 'Participant'}
                    </span>
                  </div>

                  {/* Choice action buttons */}
                  {canDecide ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                        {isMeSelected ? "Choose your challenge:" : "Choose on behalf of participant:"}
                      </span>
                      <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '240px' }}>
                        <button 
                          type="button"
                          onClick={() => handleSelectTodChoice('Truth')} 
                          className="btn-create" 
                          style={{ flex: 1, padding: '10px', fontSize: '13px', background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', borderColor: 'transparent', color: '#fff', fontWeight: 700 }}
                        >
                          😇 Truth
                        </button>
                        <button 
                          type="button"
                          onClick={() => handleSelectTodChoice('Dare')} 
                          className="btn-create" 
                          style={{ flex: 1, padding: '10px', fontSize: '13px', background: 'linear-gradient(135deg, #ec4899, #be185d)', borderColor: 'transparent', color: '#fff', fontWeight: 700 }}
                        >
                          😈 Dare
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Waiting for {selectedUser?.name} to choose...
                    </span>
                  )}

                  {canDecide && (
                    <button 
                      type="button"
                      onClick={handleResetTod} 
                      className="btn-signin"
                      style={{ marginTop: '16px', fontSize: '11px', padding: '6px 12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                    >
                      Reset / Spin Again
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Reveal prompt phase */}
        {todState === 'reveal' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px', padding: '16px 0' }}>
            {(() => {
              const selectedUser = callParticipants.find(p => p.id === todSelectedId);
              
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px' }}>
                  <div className={`truthordare-card type-${todChoice?.toLowerCase() || 'truth'} ${isExpanded ? 'expanded' : ''}`} style={{ width: '100%', maxWidth: isExpanded ? '500px' : 'none' }}>
                    <div className="card-badge" style={{
                      display: 'inline-block',
                      fontSize: '9px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      marginBottom: '12px',
                      backgroundColor: todChoice === 'Truth' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(236, 72, 153, 0.15)',
                      color: todChoice === 'Truth' ? '#3b82f6' : '#ec4899'
                    }}>
                      {todChoice} for {selectedUser?.name.replace(' (You)', '')}
                    </div>
                    <div className="truthordare-text" style={{ fontSize: isExpanded ? '20px' : '15px', fontWeight: 700, margin: '8px 0 0 0' }}>
                      "{todText}"
                    </div>
                  </div>

                  {canDecide ? (
                    <button 
                      type="button"
                      onClick={handleResetTod} 
                      className="btn-signin"
                      style={{ width: '100%', maxWidth: '200px', padding: '10px', fontWeight: 700, backgroundColor: 'var(--primary-color)', color: '#0f1013', border: 'none' }}
                    >
                      Done (Next Turn)
                    </button>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Waiting for completion...
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        )}

      </div>

      {/* Sidebar participant list for opt-in game model */}
      {(todState === 'idle' || todState === 'spinning') && (
        <div className="spinner-participants-sidebar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
            {todActiveIds.includes(myId) || todPendingIds.includes(myId) ? (
              <button 
                type="button" 
                onClick={handleLeaveTodGame} 
                className="btn-signin"
                style={{ width: '100%', padding: '8px', color: '#ef4444', borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.05)', fontWeight: 600 }}
              >
                Leave Game
              </button>
            ) : (
              <button 
                type="button" 
                onClick={handleJoinTodGame} 
                className="btn-create"
                style={{ width: '100%', padding: '8px', fontWeight: 600 }}
              >
                Join Game
              </button>
            )}
          </div>

          {(() => {
            const joinedPlayers = callParticipants.filter(p => todActiveIds.includes(p.id) || todPendingIds.includes(p.id));
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Players ({joinedPlayers.length}/{callParticipants.length})
                  </span>
                  <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', color: 'var(--text-secondary)' }}>
                    Pool: {todSpinPool.filter(id => activeIds.includes(id)).length} left
                  </span>
                </div>

                <div className="spinner-participants-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {joinedPlayers.map(p => {
                    const isActive = todActiveIds.includes(p.id);
                    const isPending = todPendingIds.includes(p.id);
                    
                    let statusText = '';
                    let statusColor = '';
                    if (isActive) {
                      statusText = '🎮 In Game';
                      statusColor = 'var(--primary-color)';
                    } else if (isPending) {
                      statusText = '⏳ Pending Next';
                      statusColor = '#f59e0b';
                    }

                    return (
                      <div key={p.id} className="spinner-participant-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
                            {p.name.replace(' (You)', '')}
                          </span>
                          {todSpinPool.includes(p.id) && isActive && (
                            <span style={{ fontSize: '8px', color: 'var(--primary-color)', background: 'rgba(241, 196, 15, 0.1)', padding: '2px 4px', borderRadius: '4px' }}>
                              Pool
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: statusColor }}>
                          {statusText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

interface SpinWheelUIProps {
  isExpanded: boolean;
  myId: string;
  callParticipants: Participant[];
  spinCheckedIds: string[];
  spinPool: string[];
  spinResult: any;
  spinLocalSpinning: boolean;
  handleSpinWheel: () => void;
  handleToggleSpinCheckedParticipant: (id: string) => void;
}

export function SpinWheelUI({
  isExpanded,
  myId,
  callParticipants,
  spinCheckedIds,
  spinPool,
  spinResult,
  spinLocalSpinning,
  handleSpinWheel,
  handleToggleSpinCheckedParticipant
}: SpinWheelUIProps) {
  const myPresence = callParticipants.find(p => p.id === myId);
  const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

  const activeIds = spinCheckedIds.length > 0 
    ? spinCheckedIds.filter(id => callParticipants.some(p => p.id === id))
    : callParticipants.map(p => p.id);

  const spinParticipants = callParticipants.filter(p => activeIds.includes(p.id));
  const n = spinParticipants.length;
  const size = isExpanded ? 360 : 200;

  return (
    <div className={`spinwheel-layout-container ${isExpanded ? 'expanded' : ''}`}>
      <div className="spinner-main-area">
        <WheelSVG
          spinParticipants={spinParticipants}
          angle={spinResult ? spinResult.angle : 0}
          size={size}
          isExpanded={isExpanded}
          onSpin={handleSpinWheel}
        />

        {spinResult && !spinLocalSpinning && (
          <div className="spin-result-banner animate-fade-in" style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Landed on</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary-color)', marginTop: '2px' }}>
              {callParticipants.find(p => p.id === spinResult.selectedId)?.name.replace(' (You)', '') || 'Participant'}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>Spun by {spinResult.spunBy}</div>
          </div>
        )}
      </div>

      <div className="spinner-participants-sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Checked ({n}/{callParticipants.length})
          </span>
          <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', color: 'var(--text-secondary)' }}>
            Pool: {spinPool.length} left
          </span>
        </div>

        <div className="spinner-participants-list">
          {callParticipants.map(p => {
            const isChecked = activeIds.includes(p.id);
            return (
              <div key={p.id} className="spinner-participant-row" onClick={() => isHostOrAdmin && handleToggleSpinCheckedParticipant(p.id)} style={{ cursor: isHostOrAdmin ? 'pointer' : 'default' }}>
                {isHostOrAdmin ? (
                  <input 
                    type="checkbox" 
                    checked={isChecked} 
                    onChange={() => {}} 
                    style={{ cursor: 'pointer' }}
                  />
                ) : (
                  <span style={{ fontSize: '12px' }}>{isChecked ? '✅' : '⬜'}</span>
                )}
                <span style={{ fontSize: '12px', fontWeight: isChecked ? 600 : 400, color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, marginLeft: '6px' }}>
                  {p.name}
                </span>
                {spinPool.includes(p.id) && isChecked && (
                  <span style={{ fontSize: '8px', color: 'var(--primary-color)', background: 'rgba(59, 130, 246, 0.1)', padding: '2px 4px', borderRadius: '4px' }}>
                    Pool
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
