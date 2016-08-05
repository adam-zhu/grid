(function (window) {

  'use strict';

  var maquette = window.maquette,
      h = maquette.h,
      projector = maquette.createProjector(),
      params = {
        name: encodeURIComponent('datboi'),
        age: encodeURIComponent('indeterminate')
      },
      parameters = "name="+params.name+"&age="+params.age,
      today = Date.now();
      

  /******************
  app state object
  ******************/
  var state = {
        selectedStations: [],
        selectedDemos: [],
        availableStations: [],
        availableDemos: [],
        queriedDemos: [],
        timeSlotData: new Immutable.List(new Array(96)),
        $root: document.getElementById("app"),
        count: 60,
        demoCount: 20,
        programAccumulates: new Map()
      };

  function setState(nextState) {
    Object.getOwnPropertyNames(nextState).forEach(function(prop) {
      state[prop] = nextState[prop]
    });
    // trigger vdom diff and rerender
    projector.scheduleRender();
    window.removeEventListener('scroll', onScroll, false);
    window.addEventListener('scroll', onScroll, false);
  }

  function getData(date, market, type, callback, demo) {
    var postRequest = new ajaxRequest(),
        endpointUrl = "http://adamz.hu/grid/"+date+market+"/"+type;

    if (type == 'demoData' && demo) {
      endpointUrl += ("/"+demo)
    }

    postRequest.onreadystatechange = function() {
     if (postRequest.readyState == 4) {
      if (callback && postRequest.status == 200 || window.location.href.indexOf("http") == -1) {
        var data = JSON.parse(postRequest.responseText);
        callback(data, type, demo);
      }
     }
    }

    postRequest.open(
      "POST",
      endpointUrl,
      true
    );
    postRequest.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
    postRequest.send(parameters);
  }

  function ingest(response, type, demo) {
    switch (type) {
      case 'stations':
        setState({
          availableStations: response
        });
      break;
      case 'demos':
        setState({
          availableDemos: response
        });
      break;
      case 'demoData':
        console.log('ingesting '+type+' '+demo);
        var timer = Date.now();
        var timeSlots = response[0].dates[0].timeSlots,
            gridData = [],
            timeSlotData = state.timeSlotData,
            queriedDemos = state.queriedDemos,
            programAccumulates = state.programAccumulates;

        timeSlots.sort(function(a,b){return a.timeSlot-b.timeSlot});
        _.find(state.queriedDemos, function(d) {return d.id == demo}).hasData = true;

        timeSlots.forEach(function(timeSlot, index) {
          timeSlot.stations.map(function(station){
            var demoData = station.demographics[0];
            station.programId = demo+""+station.programId+""+station.stationId+station.episodeName;
            if (programAccumulates.has(station.programId)) {
              programAccumulates.set(station.programId, programAccumulates.get(station.programId).concat({rt: demoData.rt}));
            } else {
              programAccumulates.set(station.programId, [].concat({rt: demoData.rt}));
            }
          });
        });

        for (var index=0, len=timeSlots.length; index<len; index++) {
          if (timeSlotData.get(index)) {
            timeSlots[index].stations.map(function(station) {
              var programChunks = programAccumulates.get(station.programId),
                  duration = programChunks.length,
                  stationData = new Immutable.Map(),
                  demoData = station.demographics[0];
              if (timeSlotData.get(index).stations.has(station.stationId)) {
                var thisStationData = timeSlotData.get(index).stations.get(station.stationId);
                if (!thisStationData.has(demoData.demographicId)) {
                  timeSlotData = timeSlotData.set(
                    index,
                    {
                      stations: timeSlotData.get(index).stations.set(
                        station.stationId,
                        thisStationData.set(demoData.demographicId, {
                          episodeName: station.episodeName,
                          programId: station.programId,
                          duration: duration,
                          seriesName: station.seriesName,
                          ratings: {rt: demoData.rt},
                          avg: getAverage(programChunks)
                        })
                      )
                    }
                  );
                }
              } else {
                stationData = stationData.set(demoData.demographicId, {
                  episodeName: station.episodeName,
                  programId: station.programId,
                  seriesName: station.seriesName,
                  duration: duration,
                  ratings: {rt: demoData.rt},
                  avg: getAverage(programChunks)
                });
                timeSlotData = timeSlotData.set(
                  index,
                  {
                    stations: timeSlotData.get(index).stations.set(station.stationId, stationData)
                  }
                );
              }
            });
          } else {
            var stationsMap = new Immutable.Map();
            timeSlots[index].stations.map(function(station) {
              var programChunks = programAccumulates.get(station.programId),
                  duration = programChunks.length,
                  demoData = station.demographics[0],
                  stationData = new Immutable.Map().set(demoData.demographicId, {
                    episodeName: station.episodeName,
                    programId: station.programId,
                    seriesName: station.seriesName,
                    duration: duration,
                    ratings: {rt: demoData.rt},
                    avg: getAverage(programChunks)
                  });
              stationsMap = stationsMap.set(station.stationId, stationData);
            });
            timeSlotData = timeSlotData.set(index, {stations: stationsMap, programAccumulates: programAccumulates});
          }
        }


        setState({
          timeSlotData: timeSlotData,
          queriedDemos: queriedDemos,
          programAccumulates: programAccumulates
        });
        console.log('ingest complete '+(Date.now()-timer)/1000+'s')
      break;
    }
  }

  function render() {
    //console.log('rendering...')
    var timer = Date.now();
    //console.log(state)
    var components = [];

    components.push(h('h1', 'Single Day Grid'));
    components.push(h('h2.market', 'New York market, April 16 2016'));

    if (state.availableStations)
      components.push(renderSelect(state.availableStations, 'stations', handleSelect));
    if (state.availableDemos)
      components.push(renderSelect(state.availableDemos, 'demos', handleSelect));


    if (state.selectedDemos.length > 0 && state.selectedStations.length > 0) {
      components.push(
        renderTimeGrid(state.selectedStations, state.selectedDemos, state.timeSlotData)
      );
    } else {
      components.push(h('p', 'select stations and demographics to view grid data'));
    }

    //console.log('render complete '+(Date.now()-timer)/1000+'s')
    return h('div', components);
  }

  function renderSelect(options, type, handleChange) {
    var selectOptions = [];
    options.forEach(function(option) {
      selectOptions.push(
        h('option', {
          value: option.id,
          key: option.id,
          selected: type == 'demos' ?
                      state.selectedDemos && _.find(state.selectedDemos, function(demo) {return demo.id==option.id})
                    :
                      state.selectedStations && _.find(state.selectedStations, function(station) {return station.id==option.id})
        }, option.name)
      );
    });
    return  h('select.'+type, {
              key: type,
              id: type,
              onchange: handleChange,
              multiple: 1
            }, selectOptions);
  }

  function handleSelect(e) {
    var type = e.target.id,
        selected = [];

    e.target.childNodes.forEach(function(option) {
      if (option.selected) {
        selected.push({id: parseInt(option.value), name: option.text})
      }
    });
    
    if (type == 'demos') {
      var queriedDemos = state.queriedDemos;
      selected.map(function(option) {
        if (!_.find(state.queriedDemos, function(d) {return d.id == option.id})) {
          getData(20160416, 270, 'demoData', ingest, parseInt(option.id));
          queriedDemos.push({id: option.id, hasData: false});
        }
      });
      setState({
        selectedDemos: selected,
        count: 60,
        demoCount: 20,
        queriedDemos: queriedDemos
      });
    } else {
      setState({
        selectedStations: selected,
        count: 60,
        demoCount: 20
      });
    }
  }


  function renderTimeGrid(selectedStations, selectedDemos, data) {
    var grid = [],
        tableHeader = [],
        tableHeaderRow = [],
        tableBody = [],
        ct = 0;

    tableHeaderRow.push( h('span.time', '') );
    tableHeaderRow.push( h('span.stationName', '') );
    tableHeaderRow.push( h('span.seriesName', '') );
    tableHeaderRow.push( h('span.duration.cell', '') );

    var demoCt = 0;
    for (var i=0, len=state.selectedDemos.length; i<len; i++) {
      if (_.find(state.queriedDemos, function(d) {return d.id == state.selectedDemos[i].id && d.hasData})) {
        tableHeaderRow.push(
          h('span.cell', {
            key: state.selectedDemos[i].id+'-headerCell'
          }, state.selectedDemos[i].name)
        );
        demoCt++;
      }
      if (demoCt >= state.demoCount)
        break;
    }

    tableHeader.push(
      h('div.tableHeaderRow.demos', tableHeaderRow)
    );

    tableHeaderRow = [];
    tableHeaderRow.push(h('span.time', ''));
    tableHeaderRow.push(h('span.stationName', 'station'));
    tableHeaderRow.push(h('span.seriesName', 'series'));
    tableHeaderRow.push(h('span.duration.cell', 'duration'));

    demoCt = 0;
    for (var i=0, len=state.selectedDemos.length; i<len; i++) {
      if (_.find(state.queriedDemos, function(d) {return d.id == state.selectedDemos[i].id && d.hasData})) {
        tableHeaderRow.push(
          h('span.cell.headerCell', {
            key: state.selectedDemos[i].id+'-headerCell'
          }, [
            h('span.rating', {key: 'rt'}, 'rt'),
            h('span.avg', {key: 'rtavg'}, 'avg')
          ])
        );
        demoCt++;
      }
      if (demoCt >= state.demoCount)
        break;
    }

    tableHeader.push(
      h('div.tableHeaderRow', tableHeaderRow)
    );


    //var dataTimeSlots = data.toArray();
    //for (var index=0, l=dataTimeSlots.length; index<l; index++) {
    for (var index=0, l=data.size; index<l; index++) {
      var timeSlot = data.get(index),
          timeSlotRows = [];
      if (ct >= state.count)
          break;
      for (var i=0, len=selectedStations.length; i<len; i++) {
        if (ct >= state.count)
          break;
        if (selectedStations[i]) {
          var station = selectedStations[i],
              selectedStationObj = _.find(state.availableStations, function(s){return s.id==station.id}),
              selectedStationName = selectedStationObj ? selectedStationObj.name : '---',
              row = [],
              seriesName = '---',
              duration = [],
              demoCt = 0;
          for (var j=0, length=state.demoCount; j<length; j++) {
            var demo = selectedDemos[j];
            if (timeSlot && demo) {
              var timeSlotStation = timeSlot.stations.get(station.id),
                  programAccumulates = state.programAccumulates;
              if (_.find(state.queriedDemos, function(d) {return d.id == demo.id && d.hasData})) {
                demoCt++;
                if (timeSlotStation && timeSlotStation.has(demo.id)) {
                  var stationDemo = timeSlotStation.get(demo.id),
                      programChunks = programAccumulates.get(stationDemo.programId),
                      thisDuration = programChunks ? programChunks.length : -1;
                  duration.push(programChunks ? programChunks.length : -1);
                  seriesName = stationDemo.seriesName;
                  row.push(
                    h('span.cell', {
                      key: station.id+''+demo.id+'rt'
                    }, [
                      h('span.rating', {key: 'rt'}, stationDemo.ratings.rt),
                      h('span.avg', {key: 'rtavg'}, stationDemo.avg.rt)
                    ])
                  );
                } else {
                  if (_.find(state.queriedDemos, function(d) {return d.id == demo.id && d.hasData})) {
                    row.push(
                      h('span.cell', {
                          key: station.id+''+demo.id
                        }, [
                          h('span.placeholder', {key: station.id+''+demo.id+'rt1'}, '---'),
                          h('span.placeholder', {key: station.id+''+demo.id+'rt2'}, '---')
                        ]
                      )
                    );
                  }
                }
              }
            }
          }
        }
        timeSlotRows.push(
          h('div.row', {
            key: index+''+station.id
          }, [
            h('span.time', timeSlotToTime(index)),
            h('span.stationName', selectedStationName),
            h('span.seriesName', seriesName),
            h('span.duration.cell', Math.max(...duration) > 0 ? Math.max(...duration)*15 / 60 +' hr' : '---'),
            row
          ])
        );
        ct++;
      }
      tableBody.push(h('div.timeSlot.'+index, timeSlotRows))
    }

      return  h('div.grid',
                h('div.gridHeader', tableHeader),
                h('div.gridBody', tableBody)
              )
  }


  function start(date, market) {
    projector.merge(state.$root, render);
    getData(date, market, 'stations', ingest);
    getData(date, market, 'demos', ingest);
  }

  function getAverage(rows) {
    var avg = {rt: 0};
    rows.map(function(row) {
      //avg.aa += (+row.aa);
      //avg.pt += (+row.pt);
      avg.rt += (+row.rt);
      //avg.sh += (+row.sh);
    });
    //avg.aa = Math.floor(avg.aa/rows.length * 100)/100;
    //avg.pt = Math.floor(avg.pt/rows.length * 100)/100;
    avg.rt = Math.floor(avg.rt/rows.length * 100)/100;
    //avg.sh = Math.floor(avg.sh/rows.length * 100)/100;
    return avg;
  }


  function onScroll(e) {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50 && state.count < state.selectedStations.length * 96) {
      window.removeEventListener('scroll', onScroll, false);
      setState({
        count: state.count <= state.selectedStations.length * 96 - 60 ? state.count + 60 : state.selectedStations.length * 96
      })
    }
    if ((window.innerWidth + window.scrollX) >= document.body.scrollWidth - 50 && state.demoCount < state.selectedDemos.length) {
      window.removeEventListener('scroll', onScroll, false);
      setState({
        demoCount: state.demoCount <= state.selectedDemos.length - 10 ? state.demoCount + 10 : state.selectedDemos.length
      })
    }
  }

  function timeSlotToTime(slot) {
    var hour = Math.floor(slot/4),
        minute = slot%4 * 15;
    return (
      (hour == 0 ? '12' : (hour > 12 ? ''+(hour-12) : hour)) +':'+ (minute == 0 ? '00' : minute) + (hour >= 12 ? 'pm' : 'am')
    )
  }


  function ajaxRequest(){
    var activexmodes = ["Msxml2.XMLHTTP", "Microsoft.XMLHTTP"]
    if (window.ActiveXObject) {
      for (var i=0; i<activexmodes.length; i++) {
        try {
            return new ActiveXObject(activexmodes[i])
        } catch(e) { console.error(e) }
      }
    } else {
      if (window.XMLHttpRequest)
        return new XMLHttpRequest()
      else
        return false
    }
  }


  document.addEventListener('DOMContentLoaded', function() {
    start(20160416, 270);
  });




})(window);
