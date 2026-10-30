// Datos sintéticos para la auditoría visual. No conecta a Supabase ni usa llaves.
(() => {
  const prices = {'quesa-maiz-queso':25,'quesa-queso':35,'volcan-queso':35,'costra-queso':45,'media-costra-queso':25,'bolsa-verdura':15,'tortilla-harina':10,'tortilla-maiz':10};
  const meats = ['pastor','bistec','tripa','chorizo'];
  for (const meat of meats) {
    for (const [prefix,price] of Object.entries({'taco':20,'taco-queso':30,'gringa':45,'llenadora':55,'volcan':40,'costra':50,'media-costra':28})) prices[`${prefix}-${meat}`]=price;
  }
  const state = {
    failWrites:false, log:[], callbacks:[],
    db:{
      config:[{id:1,nombre_negocio:'La Tequería',precios:prices,extras:[],ocultos:[]}],
      carnes:meats.map((id,orden)=>({id,nombre:id[0].toUpperCase()+id.slice(1),activo:true,orden})),
      bebidas:[{id:'coca',nombre:'Coca-Cola',cantidad:24,activo:true,precio:25},{id:'jamaica',nombre:'Agua de Jamaica',cantidad:20,activo:true,precio:20}],
      usuarios:[{id:'ux-admin',nombre:'Administrador de prueba',rol:'admin'},{id:'ux-mesero',nombre:'Mesero de prueba',rol:'mesero'},{id:'ux-cocina',nombre:'Cocina de prueba',rol:'cocinero'}],
      mesas:Array.from({length:8},(_,i)=>({id:i+1,estado:'libre',pedido:null,extras:[]})),
      tickets:[],gastos:[],cortes:[],
    },
  };
  window.__UX_FIXTURE__=state;
  const copy=(x)=>JSON.parse(JSON.stringify(x));
  const emit=(table)=>state.callbacks.forEach((callback)=>callback({table}));
  window.__UX_SUPABASE__={
    from(table){
      let action='select',payload=null,single=false,order=null;
      const filters=[];
      const query={
        select(){return this;},
        eq(key,value){filters.push(row=>row[key]===value);return this;},
        is(key,value){filters.push(row=>(row[key]??null)===value);return this;},
        order(key,options){order={key,ascending:options?.ascending!==false};return this;},
        maybeSingle(){single=true;return this;},
        insert(value){action='insert';payload=value;return this;},
        upsert(value){action='upsert';payload=value;return this;},
        update(value){action='update';payload=value;return this;},
        delete(){action='delete';return this;},
        then(resolve,reject){
          return Promise.resolve().then(()=>{
            state.log.push({table,action});
            if(action!=='select'&&state.failWrites) return {data:null,error:{message:'Fallo de escritura simulado'}};
            const rows=state.db[table]||(state.db[table]=[]);
            const matches=(row)=>filters.every(fn=>fn(row));
            if(action==='insert') rows.push(...copy(Array.isArray(payload)?payload:[payload]));
            if(action==='upsert') for(const item of (Array.isArray(payload)?payload:[payload])) {const i=rows.findIndex(x=>x.id===item.id);if(i>=0)Object.assign(rows[i],copy(item));else rows.push(copy(item));}
            if(action==='update') rows.filter(matches).forEach(row=>Object.assign(row,copy(payload)));
            if(action==='delete') state.db[table]=rows.filter(row=>!matches(row));
            let result=copy(state.db[table].filter(matches));
            if(order) result.sort((a,b)=>String(a[order.key]??'').localeCompare(String(b[order.key]??''))*(order.ascending?1:-1));
            if(action!=='select') setTimeout(()=>emit(table),0);
            return {data:single?(result[0]||null):result,error:null};
          }).then(resolve,reject);
        },
      };
      return query;
    },
    async rpc(name,args){
      state.log.push({rpc:name});
      if(name==='login') return {data:args.p_pin==='2468'?copy(state.db.usuarios.filter(x=>x.id===args.p_id)):[],error:null};
      if(['claim_cocina','latido_cocina'].includes(name)) return {data:true,error:null};
      if(name==='liberar_cocina') return {data:null,error:null};
      return {data:null,error:{message:'RPC fuera del alcance de la fixture'}};
    },
    channel(){return {on(_event,_filter,callback){state.callbacks.push(callback);return this;},subscribe(callback){setTimeout(()=>callback('SUBSCRIBED'),0);return this;}};},
    removeChannel(){state.callbacks=[];},
  };
})();
