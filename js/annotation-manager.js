/**
 * Antigravity PDF Studio - Clean & Optimized Annotation Engine
 * Supports Freehand Ink, Highlighter, Vector Shapes (Lines, Arrows, Callouts), Text,
 * Pins, Layer Toggles, and Full Undo/Redo Stack.
 */

export class AnnotationManager {
  constructor(commentsContainerElement) {
    this.commentsContainer = commentsContainerElement;
    
    this.currentTool = 'select';
    this.currentColor = '#f43f5e';
    this.currentStrokeWidth = 3;
    this.currentFontSize = 14;
    this.currentOpacity = 1.0;
    this.highlighterSubMode = 'line'; // 'line' or 'freehand'

    this.layerVisibility = {
      strokes: true,
      shapes: true,
      text: true,
      pins: true
    };

    this.annotations = {}; // { [pageNum]: { strokes: [], shapes: [], textAnnots: [], comments: [] } }
    this.historyStack = [];
    this.redoStack = [];

    this.isDrawing = false;
    this.startPt = null;
    this.currentPt = null;
    this.currentPath = [];

    this.onCommentAdded = null;
    this.onCommentJump = null;
  }

  setTool(toolName) {
    this.currentTool = toolName;
    this.updateCanvasInteractivity();
  }

  setColor(colorHex) {
    this.currentColor = colorHex;
  }

  setStrokeWidth(width) {
    const num = parseInt(width, 10);
    if (!isNaN(num) && num >= 1) {
      this.currentStrokeWidth = num;
    }
  }

  setOpacity(val) {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      this.currentOpacity = Math.min(Math.max(0.1, num), 1.0);
    }
  }

  toggleHighlighterSubMode() {
    this.highlighterSubMode = this.highlighterSubMode === 'line' ? 'freehand' : 'line';
    return this.highlighterSubMode;
  }

  toggleLayer(layerName) {
    if (this.layerVisibility[layerName] !== undefined) {
      this.layerVisibility[layerName] = !this.layerVisibility[layerName];
      this.refreshAllPageLayers();
      return this.layerVisibility[layerName];
    }
    return true;
  }

  refreshAllPageLayers() {
    const pageCards = document.querySelectorAll('.pdf-page-card');
    pageCards.forEach(card => {
      const pageNum = parseInt(card.dataset.pageNum, 10);
      const canvas = card.querySelector('.annotation-layer-canvas');
      if (canvas) {
        this.redrawPageCanvas(pageNum, canvas);
      }
      this.renderCommentPinsForPage(pageNum, card);
    });
  }

  updateCanvasInteractivity() {
    const activeTools = ['pen', 'line', 'arrow', 'text', 'callout', 'eraser', 'comment'];
    const annotCanvases = document.querySelectorAll('.annotation-layer-canvas');
    annotCanvases.forEach(canvas => {
      if (activeTools.includes(this.currentTool)) {
        canvas.classList.add('active-draw');
      } else {
        canvas.classList.remove('active-draw');
      }
    });
  }

  attachToPageCards() {
    const pageCards = document.querySelectorAll('.pdf-page-card');
    pageCards.forEach(card => {
      const pageNum = parseInt(card.dataset.pageNum, 10);
      const canvas = card.querySelector('.annotation-layer-canvas');
      if (!canvas) return;

      this.ensurePageObject(pageNum);

      this.redrawPageCanvas(pageNum, canvas);
      this.renderCommentPinsForPage(pageNum, card);

      canvas.onpointerdown = (e) => this.handlePointerDown(e, pageNum, canvas, card);
      canvas.onpointermove = (e) => this.handlePointerMove(e, pageNum, canvas);
      canvas.onpointerup = (e) => this.handlePointerUp(e, pageNum, canvas);
      canvas.onpointerleave = (e) => this.handlePointerUp(e, pageNum, canvas);
    });

    this.updateCanvasInteractivity();
  }

  ensurePageObject(pageNum) {
    if (!this.annotations[pageNum]) {
      this.annotations[pageNum] = { strokes: [], shapes: [], textAnnots: [], comments: [] };
    }
  }

  handlePointerDown(e, pageNum, canvas, card) {
    const rect = canvas.getBoundingClientRect();
    
    // Normalize coordinates to 0.0 - 1.0 based on CSS bounding rect
    const normX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const normY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;

    if (this.currentTool === 'comment') {
      const xPercent = normX * 100;
      const yPercent = normY * 100;
      this.addComment(pageNum, xPercent, yPercent, card);
      return;
    }

    if (this.currentTool === 'text') {
      this.addTextAnnotation(pageNum, normX, normY, canvas, rect);
      return;
    }

    if (!['pen', 'line', 'arrow', 'callout', 'eraser'].includes(this.currentTool)) return;

    this.isDrawing = true;
    this.startPt = { x: normX, y: normY };
    this.currentPt = { x: normX, y: normY };
    this.currentPath = [{ x: normX, y: normY }];

    if (this.currentTool === 'eraser') {
      this.eraseAtPoint(pageNum, normX, normY, canvas);
    }
  }

  handlePointerMove(e, pageNum, canvas) {
    if (!this.isDrawing) return;

    const rect = canvas.getBoundingClientRect();
    const normX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const normY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    this.currentPt = { x: normX, y: normY };

    if (this.currentTool === 'eraser') {
      this.eraseAtPoint(pageNum, normX, normY, canvas);
      return;
    }

    if (this.currentTool === 'pen') {
      this.currentPath.push({ x: normX, y: normY });
    }

    this.redrawPageCanvas(pageNum, canvas);
    this.drawActiveShapePreview(canvas);
  }

  handlePointerUp(e, pageNum, canvas) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    this.ensurePageObject(pageNum);

    const rect = canvas.getBoundingClientRect();

    if (this.currentTool === 'pen' && this.currentPath.length > 1) {
      const strokeObj = {
        tool: 'pen',
        color: this.currentColor,
        opacity: this.currentOpacity,
        widthNorm: this.currentStrokeWidth / rect.width,
        path: [...this.currentPath]
      };
      this.annotations[pageNum].strokes.push(strokeObj);
      this.pushHistory('add_stroke', pageNum, strokeObj);
    } else if (['line', 'arrow'].includes(this.currentTool) && this.startPt && this.currentPt) {
      const distPx = Math.hypot((this.currentPt.x - this.startPt.x) * rect.width, (this.currentPt.y - this.startPt.y) * rect.height);
      if (distPx > 5) {
        const isHighlighter = this.currentOpacity < 0.8;
        const shapeObj = {
          tool: this.currentTool,
          x1: this.startPt.x,
          y1: this.startPt.y,
          x2: this.currentPt.x,
          y2: this.currentPt.y,
          color: this.currentColor,
          opacity: this.currentOpacity,
          widthNorm: (this.currentStrokeWidth / rect.width) * (isHighlighter ? 3.5 : 1)
        };
        this.annotations[pageNum].shapes.push(shapeObj);
        this.pushHistory('add_shape', pageNum, shapeObj);
      }
    } else if (this.currentTool === 'callout' && this.startPt && this.currentPt) {
      const distPx = Math.hypot((this.currentPt.x - this.startPt.x) * rect.width, (this.currentPt.y - this.startPt.y) * rect.height);
      if (distPx > 5) {
        const textStr = prompt('引出線テキストを入力してください (Callout Text):');
        if (textStr && textStr.trim() !== '') {
          const calloutObj = {
            tool: 'callout',
            targetX: this.startPt.x,
            targetY: this.startPt.y,
            boxX: this.currentPt.x,
            boxY: this.currentPt.y,
            text: textStr.trim(),
            color: this.currentColor,
            fontSizeNorm: 13 / rect.height
          };
          this.annotations[pageNum].shapes.push(calloutObj);
          this.pushHistory('add_shape', pageNum, calloutObj);
        }
      }
    }

    this.startPt = null;
    this.currentPt = null;
    this.currentPath = [];
    this.redrawPageCanvas(pageNum, canvas);
  }

  addTextAnnotation(pageNum, normX, normY, canvas, rect) {
    const textStr = prompt('テキストを入力してください (Enter Text):');
    if (!textStr || textStr.trim() === '') return;

    this.ensurePageObject(pageNum);

    const textObj = {
      tool: 'text',
      x: normX,
      y: normY,
      text: textStr.trim(),
      color: this.currentColor,
      fontSizeNorm: 14 / (rect ? rect.height : canvas.height)
    };

    this.annotations[pageNum].textAnnots.push(textObj);
    this.pushHistory('add_text', pageNum, textObj);
    this.redrawPageCanvas(pageNum, canvas);
  }

  pushHistory(actionType, pageNum, item) {
    this.historyStack.push({ actionType, pageNum, item });
    this.redoStack = [];
  }

  undo() {
    if (this.historyStack.length === 0) return false;
    const lastAction = this.historyStack.pop();
    this.redoStack.push(lastAction);

    const { actionType, pageNum, item } = lastAction;
    const pageObj = this.annotations[pageNum];
    if (!pageObj) return true;

    if (actionType === 'add_stroke') {
      pageObj.strokes = pageObj.strokes.filter(s => s !== item);
    } else if (actionType === 'add_shape') {
      pageObj.shapes = pageObj.shapes.filter(s => s !== item);
    } else if (actionType === 'add_text') {
      pageObj.textAnnots = pageObj.textAnnots.filter(t => t !== item);
    }

    this.refreshAllPageLayers();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const action = this.redoStack.pop();
    this.historyStack.push(action);

    const { actionType, pageNum, item } = action;
    this.ensurePageObject(pageNum);
    const pageObj = this.annotations[pageNum];

    if (actionType === 'add_stroke') {
      pageObj.strokes.push(item);
    } else if (actionType === 'add_shape') {
      pageObj.shapes.push(item);
    } else if (actionType === 'add_text') {
      pageObj.textAnnots.push(item);
    }

    this.refreshAllPageLayers();
    return true;
  }

  drawActiveShapePreview(canvas) {
    if (!this.startPt || !this.currentPt) return;

    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    
    ctx.save();

    const isHighlighter = this.currentOpacity < 0.8;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? cw / rect.width : 1;
    const baseWidth = this.currentStrokeWidth * scaleX * (isHighlighter ? 3.5 : 1);
    const alpha = this.currentOpacity;

    ctx.strokeStyle = this.currentColor;
    ctx.fillStyle = this.currentColor;
    ctx.lineWidth = baseWidth;
    ctx.globalAlpha = alpha;
    ctx.lineCap = isHighlighter ? 'square' : 'round';

    if (this.currentTool === 'pen') {
      if (this.currentPath && this.currentPath.length > 1) {
        ctx.beginPath();
        ctx.moveTo(this.currentPath[0].x * cw, this.currentPath[0].y * ch);
        for (let i = 1; i < this.currentPath.length; i++) {
          ctx.lineTo(this.currentPath[i].x * cw, this.currentPath[i].y * ch);
        }
        ctx.stroke();
      }
    } else if (this.currentTool === 'line') {
      ctx.beginPath();
      ctx.moveTo(this.startPt.x * cw, this.startPt.y * ch);
      ctx.lineTo(this.currentPt.x * cw, this.currentPt.y * ch);
      ctx.stroke();
    } else if (this.currentTool === 'arrow') {
      this.drawArrowOnCanvas(ctx, this.startPt.x * cw, this.startPt.y * ch, this.currentPt.x * cw, this.currentPt.y * ch, baseWidth, this.currentColor);
    } else if (this.currentTool === 'callout') {
      this.drawArrowOnCanvas(ctx, this.currentPt.x * cw, this.currentPt.y * ch, this.startPt.x * cw, this.startPt.y * ch, 2 * scaleX, this.currentColor);
      
      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.strokeStyle = this.currentColor;
      ctx.lineWidth = 1 * scaleX;
      ctx.fillRect((this.currentPt.x * cw), (this.currentPt.y * ch) - 20 * scaleX, 100 * scaleX, 24 * scaleX);
      ctx.strokeRect((this.currentPt.x * cw), (this.currentPt.y * ch) - 20 * scaleX, 100 * scaleX, 24 * scaleX);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${12 * scaleX}px sans-serif`;
      ctx.fillText('引出線テキスト', (this.currentPt.x * cw) + 6 * scaleX, (this.currentPt.y * ch) - 4 * scaleX);
    }

    ctx.restore();
  }

  redrawPageCanvas(pageNum, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageData = this.annotations[pageNum];
    if (!pageData) return;

    const cw = canvas.width;
    const ch = canvas.height;

    // 1. Redraw Freehand & Highlighter Strokes
    if (this.layerVisibility.strokes) {
      (pageData.strokes || []).forEach(stroke => {
        if (stroke.path.length < 2) return;
        ctx.save();
        ctx.beginPath();
        // Check if norm coordinate, else fallback to old un-normalized
        const isNorm = stroke.widthNorm !== undefined;
        ctx.moveTo(isNorm ? stroke.path[0].x * cw : stroke.path[0].x, isNorm ? stroke.path[0].y * ch : stroke.path[0].y);
        for (let i = 1; i < stroke.path.length; i++) {
          ctx.lineTo(isNorm ? stroke.path[i].x * cw : stroke.path[i].x, isNorm ? stroke.path[i].y * ch : stroke.path[i].y);
        }

        ctx.globalAlpha = stroke.opacity !== undefined ? stroke.opacity : (stroke.tool === 'highlighter' ? 0.35 : 1.0);
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.widthNorm ? (stroke.widthNorm * cw) : stroke.width;
        ctx.lineCap = (stroke.tool === 'highlighter' || (stroke.opacity && stroke.opacity < 0.8)) ? 'square' : 'round';
        ctx.stroke();
        ctx.restore();
      });
    }

    // 2. Redraw Vector Shapes (Lines, Arrows, Callouts)
    if (this.layerVisibility.shapes) {
      (pageData.shapes || []).forEach(shape => {
        const isNorm = shape.widthNorm !== undefined || shape.fontSizeNorm !== undefined;
        if (shape.tool === 'line' || shape.tool === 'highlighter_line') {
          const isHighlighter = shape.opacity !== undefined && shape.opacity < 0.8;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(isNorm ? shape.x1 * cw : shape.x1, isNorm ? shape.y1 * ch : shape.y1);
          ctx.lineTo(isNorm ? shape.x2 * cw : shape.x2, isNorm ? shape.y2 * ch : shape.y2);
          ctx.globalAlpha = shape.opacity !== undefined ? shape.opacity : 1.0;
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = shape.widthNorm ? (shape.widthNorm * cw) : shape.width;
          ctx.lineCap = isHighlighter ? 'square' : 'round';
          ctx.stroke();
          ctx.restore();
        } else if (shape.tool === 'arrow') {
          this.drawArrowOnCanvas(ctx, isNorm ? shape.x1 * cw : shape.x1, isNorm ? shape.y1 * ch : shape.y1, isNorm ? shape.x2 * cw : shape.x2, isNorm ? shape.y2 * ch : shape.y2, shape.widthNorm ? (shape.widthNorm * cw) : shape.width, shape.color);
        } else if (shape.tool === 'callout') {
          this.drawArrowOnCanvas(ctx, isNorm ? shape.boxX * cw : shape.boxX, isNorm ? shape.boxY * ch : shape.boxY, isNorm ? shape.targetX * cw : shape.targetX, isNorm ? shape.targetY * ch : shape.targetY, 2 * (cw / (canvas.clientWidth || cw)), shape.color);

          const fontSize = shape.fontSizeNorm ? (shape.fontSizeNorm * ch) : (shape.fontSize || 13);
          ctx.font = `${fontSize}px sans-serif`;
          const metrics = ctx.measureText(shape.text);
          const boxWidth = metrics.width + 16;
          const boxHeight = fontSize + 12;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = 1.5;
          const boxX = isNorm ? shape.boxX * cw : shape.boxX;
          const boxY = isNorm ? shape.boxY * ch : shape.boxY;
          ctx.fillRect(boxX, boxY - boxHeight + 4, boxWidth, boxHeight);
          ctx.strokeRect(boxX, boxY - boxHeight + 4, boxWidth, boxHeight);

          ctx.fillStyle = '#ffffff';
          ctx.fillText(shape.text, boxX + 8, boxY - 4);
        }
        ctx.restore();
      });
    }

    // 3. Redraw Text Annotations
    if (this.layerVisibility.text) {
      (pageData.textAnnots || []).forEach(t => {
        ctx.save();
        ctx.fillStyle = t.color;
        const isNorm = t.fontSizeNorm !== undefined;
        const fontSize = t.fontSizeNorm ? (t.fontSizeNorm * ch) : (t.fontSize || 14);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillText(t.text, isNorm ? t.x * cw : t.x, isNorm ? t.y * ch : t.y);
        ctx.restore();
      });
    }
  }

  drawArrowOnCanvas(ctx, fromX, fromY, toX, toY, width, color) {
    const headlen = Math.max(10, width * 3);
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(toX, toY);
    ctx.fillStyle = color;
    ctx.fill();
  }

  eraseAtPoint(pageNum, normX, normY, canvas) {
    const pageData = this.annotations[pageNum];
    if (!pageData) return;

    const rect = canvas.getBoundingClientRect();
    
    // Calculate distance in CSS pixel space to accurately represent touch threshold
    const isNear = (nx, ny, oldX, oldY, isNorm) => {
        if (isNorm) {
            const dx = (nx - normX) * rect.width;
            const dy = (ny - normY) * rect.height;
            return Math.hypot(dx, dy) < 18;
        } else {
            // Backward compatibility for old pixel annotations
            // oldX and oldY are in backing store space, so divide by scaleX to get CSS px
            const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
            const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
            const px = normX * rect.width * scaleX;
            const py = normY * rect.height * scaleY;
            return Math.hypot(oldX - px, oldY - py) < (18 * scaleX);
        }
    };

    pageData.strokes = (pageData.strokes || []).filter(stroke => {
      const isNorm = stroke.widthNorm !== undefined;
      return !stroke.path.some(pt => isNear(pt.x, pt.y, pt.x, pt.y, isNorm));
    });

    pageData.shapes = (pageData.shapes || []).filter(shape => {
      const isNorm = shape.widthNorm !== undefined || shape.fontSizeNorm !== undefined;
      if (shape.tool === 'line' || shape.tool === 'arrow') {
        return !isNear(shape.x1, shape.y1, shape.x1, shape.y1, isNorm) && !isNear(shape.x2, shape.y2, shape.x2, shape.y2, isNorm);
      } else if (shape.tool === 'callout') {
        return !isNear(shape.targetX, shape.targetY, shape.targetX, shape.targetY, isNorm) && !isNear(shape.boxX, shape.boxY, shape.boxX, shape.boxY, isNorm);
      }
      return true;
    });

    pageData.textAnnots = (pageData.textAnnots || []).filter(t => {
      const isNorm = t.fontSizeNorm !== undefined;
      return !isNear(t.x, t.y, t.x, t.y, isNorm);
    });

    this.redrawPageCanvas(pageNum, canvas);
  }

  addComment(pageNum, xPercent, yPercent, cardElement) {
    const commentText = prompt('コメントを入力してください (Add Comment):');
    if (!commentText || commentText.trim() === '') return;

    const commentObj = {
      id: Date.now().toString(),
      pageNum,
      xPercent,
      yPercent,
      author: 'ユーザー (Google User)',
      text: commentText.trim(),
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    };

    this.ensurePageObject(pageNum);
    this.annotations[pageNum].comments.push(commentObj);
    this.renderCommentPinsForPage(pageNum, cardElement);
    this.renderSidebarComments();

    if (this.onCommentAdded) {
      this.onCommentAdded(commentObj);
    }
  }

  renderCommentPinsForPage(pageNum, cardElement) {
    const existingPins = cardElement.querySelectorAll('.comment-pin');
    existingPins.forEach(p => p.remove());

    if (!this.layerVisibility.pins) return;

    const comments = this.annotations[pageNum]?.comments || [];
    comments.forEach((c, idx) => {
      const pin = document.createElement('div');
      pin.className = 'comment-pin';
      pin.dataset.commentId = c.id;
      pin.style.left = `${c.xPercent}%`;
      pin.style.top = `${c.yPercent}%`;
      pin.innerHTML = `<span>${idx + 1}</span>`;
      pin.title = `${c.author}: ${c.text}`;
      
      pin.onclick = (e) => {
        e.stopPropagation();
        alert(`【P.${c.pageNum} 注釈 #${idx + 1}】\n${c.author} (${c.timestamp}):\n${c.text}`);
      };

      cardElement.appendChild(pin);
    });
  }

  renderSidebarComments() {
    this.commentsContainer.innerHTML = '';
    
    let totalCount = 0;
    Object.keys(this.annotations).forEach(pageNumStr => {
      const pageNum = parseInt(pageNumStr, 10);
      const pageComments = this.annotations[pageNum]?.comments || [];
      
      pageComments.forEach((c, idx) => {
        totalCount++;
        const card = document.createElement('div');
        card.className = 'comment-card';
        card.title = 'クリックして該当する注釈ピンへジャンプ';
        card.innerHTML = `
          <div class="comment-card-header">
            <span class="comment-author">📍 P.${c.pageNum} ピン #${idx + 1}</span>
            <span>${c.timestamp}</span>
          </div>
          <div class="comment-text">${c.text}</div>
          <div class="comment-card-footer">
            <span>${c.author}</span>
            <button class="comment-delete-btn" data-id="${c.id}" data-page="${pageNum}">削除</button>
          </div>
        `;

        card.onclick = (e) => {
          if (e.target.classList.contains('comment-delete-btn')) return;
          if (this.onCommentJump) {
            this.onCommentJump(c.pageNum, c.id);
          }
        };

        card.querySelector('.comment-delete-btn').onclick = (e) => {
          e.stopPropagation();
          this.deleteComment(c.id, pageNum);
        };

        this.commentsContainer.appendChild(card);
      });
    });

    if (totalCount === 0) {
      this.commentsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <p style="font-size: 0.8rem;">注釈コメントはまだありません。<br>「ピン」ツールでPDF上の任意の場所をタップして追加できます。</p>
        </div>
      `;
    }
  }

  pulsePinMarker(commentId) {
    const pin = document.querySelector(`.comment-pin[data-comment-id="${commentId}"]`);
    if (pin) {
      pin.classList.add('pulse-highlight');
      setTimeout(() => {
        pin.classList.remove('pulse-highlight');
      }, 3000);
    }
  }

  deleteComment(commentId, pageNum) {
    if (!this.annotations[pageNum]) return;
    this.annotations[pageNum].comments = this.annotations[pageNum].comments.filter(c => c.id !== commentId);
    
    const pageCard = document.querySelector(`.pdf-page-card[data-page-num="${pageNum}"]`);
    if (pageCard) {
      this.renderCommentPinsForPage(pageNum, pageCard);
    }
    this.renderSidebarComments();
  }

  importAnnotations(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed) {
        this.annotations = parsed;
        this.historyStack = [];
        this.redoStack = [];
        this.refreshAllPageLayers();
        this.renderSidebarComments();
      }
    } catch (e) {
      console.error('Failed to import annotations JSON', e);
    }
  }

  hexToRgba(hex, alpha = 1.0) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
}
