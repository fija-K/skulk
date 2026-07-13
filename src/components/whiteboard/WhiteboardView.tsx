import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { ViewingShare, Participant } from '../../App';

interface WhiteboardViewProps {
  roomId: string;
  viewingShare: ViewingShare;
  setViewingShare: (val: ViewingShare | null) => void;
  myId: string;
  callParticipants: Participant[];
  updateMySharing: (fields: Record<string, unknown>) => Promise<void>;
  clearMySharing: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function WhiteboardView({
  roomId,
  viewingShare,
  setViewingShare,
  myId,
  callParticipants,
  updateMySharing,
  clearMySharing,
  showToast
}: WhiteboardViewProps) {
  const [drawColor, setDrawColor] = useState('#f1c40f'); // Neon gold as default
  const [whiteboardStrokes, setWhiteboardStrokes] = useState<any[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const activeStrokeRef = useRef<any>(null);
  const lastWhiteboardWriteTimeRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const whiteboardPresenter = (viewingShare && viewingShare.type === 'whiteboard') ? callParticipants.find(p => p.id === viewingShare.participantId) : null;
  const isWhiteboardPresenter = (viewingShare && viewingShare.type === 'whiteboard') && viewingShare.participantId === myId;
  const canDrawOnWhiteboard = isWhiteboardPresenter || (whiteboardPresenter?.whiteboardEditAllowed ?? false);

  const redrawCanvasFromStrokes = (strokes: any[], activeStroke?: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    strokes.forEach((stroke) => {
      if (!stroke.points || stroke.points.length === 0) return;
      ctx.beginPath();
      const startX = stroke.points[0][0] * canvas.width;
      const startY = stroke.points[0][1] * canvas.height;
      ctx.moveTo(startX, startY);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      for (let i = 1; i < stroke.points.length; i++) {
        const x = stroke.points[i][0] * canvas.width;
        const y = stroke.points[i][1] * canvas.height;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    
    if (activeStroke && activeStroke.points && activeStroke.points.length > 0) {
      ctx.beginPath();
      const startX = activeStroke.points[0][0] * canvas.width;
      const startY = activeStroke.points[0][1] * canvas.height;
      ctx.moveTo(startX, startY);
      ctx.strokeStyle = activeStroke.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      for (let i = 1; i < activeStroke.points.length; i++) {
        const x = activeStroke.points[i][0] * canvas.width;
        const y = activeStroke.points[i][1] * canvas.height;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  // Sync whiteboard canvas from the participant being viewed
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'whiteboard' || !roomId) return;

    const partRef = doc(db, 'rooms', roomId, 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (viewingShare.participantId !== myId) {
          setViewingShare(null);
          showToast('Whiteboard presenter has left. Ending session.');
        }
        return;
      }
      const data = snapshot.data();
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (data.whiteboardData !== undefined) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (!data.whiteboardData) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            setWhiteboardStrokes([]);
          } else if (data.whiteboardData.startsWith('[')) {
            try {
              const parsed = JSON.parse(data.whiteboardData);
              setWhiteboardStrokes(parsed);
              redrawCanvasFromStrokes(parsed, activeStrokeRef.current);
            } catch (e) {
              console.warn("Failed to parse whiteboard strokes:", e);
            }
          } else {
            const img = new Image();
            img.onload = () => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = data.whiteboardData;
          }
        }
      }
      // Close view if sharer stopped sharing
      if (!data.sharing && viewingShare.participantId !== myId) {
        setViewingShare(null);
      }
    });
    return () => unsubscribe();
  }, [viewingShare, roomId, myId]);

  const syncCurrentStrokesToFirestore = async () => {
    if (!activeStrokeRef.current || !roomId || !viewingShare || viewingShare.type !== 'whiteboard' || !canDrawOnWhiteboard) return;
    const otherStrokes = whiteboardStrokes.filter(s => s.id !== activeStrokeRef.current.id);
    const updatedStrokes = [...otherStrokes, activeStrokeRef.current];
    try {
      await updateDoc(doc(db, 'rooms', roomId, 'participants', viewingShare.participantId), { 
        whiteboardData: JSON.stringify(updatedStrokes) 
      });
    } catch (e) {
      console.warn("Failed to sync live whiteboard:", e);
    }
  };

  // Resize canvas when whiteboard view opens or draw color changes
  useEffect(() => {
    if (viewingShare?.type === 'whiteboard' && canvasRef.current) {
      const handleResize = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = canvas.parentElement?.clientWidth || 800;
        canvas.height = canvas.parentElement?.clientHeight || 500;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.lineCap = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = drawColor;
          redrawCanvasFromStrokes(whiteboardStrokes, activeStrokeRef.current);
        }
      };

      // Run immediately
      handleResize();

      // Run after a short delay to allow DOM transition/reflow to settle
      const timer = setTimeout(handleResize, 100);

      window.addEventListener('resize', handleResize);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [viewingShare?.type, drawColor, whiteboardStrokes]);

  // Mouse drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvas.width;
    const y = (e.clientY - rect.top) / canvas.height;
    
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawing(true);
    
    activeStrokeRef.current = {
      id: Math.random().toString(36).substr(2, 9),
      color: drawColor,
      points: [[x, y]]
    };
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !activeStrokeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    
    ctx.lineTo(localX, localY);
    ctx.stroke();
    
    const x = localX / canvas.width;
    const y = localY / canvas.height;
    activeStrokeRef.current.points.push([x, y]);
    
    const now = Date.now();
    if (now - lastWhiteboardWriteTimeRef.current > 150) {
      lastWhiteboardWriteTimeRef.current = now;
      syncCurrentStrokesToFirestore();
    }
  };

  const stopDrawing = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (activeStrokeRef.current) {
      const otherStrokes = whiteboardStrokes.filter(s => s.id !== activeStrokeRef.current.id);
      const updatedStrokes = [...otherStrokes, activeStrokeRef.current];
      activeStrokeRef.current = null;
      setWhiteboardStrokes(updatedStrokes);
      
      if (roomId && viewingShare && viewingShare.type === 'whiteboard' && canDrawOnWhiteboard) {
        try {
          await updateDoc(doc(db, 'rooms', roomId, 'participants', viewingShare.participantId), { 
            whiteboardData: JSON.stringify(updatedStrokes) 
          });
        } catch (e) {
          console.warn("Failed to commit whiteboard stroke:", e);
        }
      }
    }
  };

  // Touch drawing handlers (for mobile support)
  const startDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / canvas.width;
    const y = (touch.clientY - rect.top) / canvas.height;
    
    ctx.beginPath();
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawing(true);
    
    activeStrokeRef.current = {
      id: Math.random().toString(36).substr(2, 9),
      color: drawColor,
      points: [[x, y]]
    };
  };

  const drawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !activeStrokeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const localX = touch.clientX - rect.left;
    const localY = touch.clientY - rect.top;
    
    ctx.lineTo(localX, localY);
    ctx.stroke();
    
    const x = localX / canvas.width;
    const y = localY / canvas.height;
    activeStrokeRef.current.points.push([x, y]);
    
    const now = Date.now();
    if (now - lastWhiteboardWriteTimeRef.current > 150) {
      lastWhiteboardWriteTimeRef.current = now;
      syncCurrentStrokesToFirestore();
    }
  };

  const clearCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setWhiteboardStrokes([]);
    activeStrokeRef.current = null;
    showToast('Whiteboard cleared');
    if (roomId && viewingShare && viewingShare.type === 'whiteboard' && canDrawOnWhiteboard) {
      try {
        await updateDoc(doc(db, 'rooms', roomId, 'participants', viewingShare.participantId), { whiteboardData: '' });
      } catch (e) {
        console.warn("Failed to clear whiteboard in Firestore:", e);
      }
    }
  };

  return (
    <div className="whiteboard-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', border: 'none', borderRadius: 0 }}>
      <div className="whiteboard-toolbar">
        <div className="whiteboard-tools-left">
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Whiteboard {viewingShare.participantId !== myId ? `(viewing ${callParticipants.find(p => p.id === viewingShare.participantId)?.name.replace(' (You)', '') || 'participant'})` : '(You)'}
          </span>
          {viewingShare.participantId !== myId && (
            <span 
              style={{ 
                fontSize: '11px', 
                padding: '2px 8px', 
                borderRadius: '12px', 
                backgroundColor: whiteboardPresenter?.whiteboardEditAllowed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)', 
                color: whiteboardPresenter?.whiteboardEditAllowed ? '#10b981' : 'var(--text-secondary)',
                border: `1px solid ${whiteboardPresenter?.whiteboardEditAllowed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                fontWeight: 600,
                marginLeft: '8px'
              }}
            >
              {whiteboardPresenter?.whiteboardEditAllowed ? 'Collaborative' : 'View Only'}
            </span>
          )}
          {canDrawOnWhiteboard && (
          <div className="whiteboard-color-pickers">
            {['#f1c40f', '#ef4444', '#10b981', '#3b82f6', '#ffffff'].map(color => (
              <div 
                key={color}
                className={`whiteboard-color-dot ${drawColor === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => setDrawColor(color)}
                title={`Select ${color} pen`}
              />
            ))}
          </div>
          )}
          {viewingShare.participantId === myId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Allow members to edit</span>
              <label className="switch-toggle">
                <input 
                  type="checkbox" 
                  checked={whiteboardPresenter?.whiteboardEditAllowed ?? false} 
                  onChange={async (e) => {
                    await updateMySharing({ whiteboardEditAllowed: e.target.checked });
                  }} 
                />
                <span className="switch-slider"></span>
              </label>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {viewingShare.participantId === myId && (
            <button onClick={clearCanvas} className="btn-signin" style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              Clear
            </button>
          )}
          <button 
            onClick={async () => {
              if (viewingShare.participantId === myId) {
                await clearMySharing();
              }
              setViewingShare(null);
            }} 
            className="btn-create" 
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            {viewingShare.participantId === myId ? 'Stop sharing' : 'Close view'}
          </button>
        </div>
      </div>
      <canvas 
        ref={canvasRef}
        className="whiteboard-canvas"
        onMouseDown={canDrawOnWhiteboard ? startDrawing : undefined}
        onMouseMove={canDrawOnWhiteboard ? draw : undefined}
        onMouseUp={canDrawOnWhiteboard ? stopDrawing : undefined}
        onMouseLeave={canDrawOnWhiteboard ? stopDrawing : undefined}
        onTouchStart={canDrawOnWhiteboard ? startDrawingTouch : undefined}
        onTouchMove={canDrawOnWhiteboard ? drawTouch : undefined}
        onTouchEnd={canDrawOnWhiteboard ? stopDrawing : undefined}
        style={{ cursor: canDrawOnWhiteboard ? 'crosshair' : 'default', flex: 1, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
