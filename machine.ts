function valueEnumerable<T>(value: T) {
  return { enumerable: true, value };
}

function valueEnumerableWritable<T>(value: T) {
  return { enumerable: true, writable: true, value };
}

interface Debug {
  _create?: <S>(current: keyof S, states: { [K in keyof S]: MachineState }) => void;
}
export let d: Debug = {};

const truthy = (...params: any) => true;
const empty = (...params: any) => ({});
const identity = <T>(a: T) => a;
const callBoth = <Self, Args extends any[]>(
  par: (...args: Args) => any,
  fn: (...args: Args) => any,
  self: Self,
  args: Args
) => par.apply(self, args) && fn.apply(self, args);
const callForward = <
  Self,
  Par extends (a: any, b: any) => any,
  Fn extends (a: ReturnType<Par>, b: Parameters<Par>[1]) => any
>(
  par: Par,
  fn: Fn,
  self: Self,
  [a, b]: Parameters<Par>
) => fn.call(self, par.call(self, a, b), b);
const create = <
  A extends object | null,
  B extends PropertyDescriptorMap & ThisType<any>
>(a: A, b: B) => Object.freeze(Object.create(a, b));

function stack(fns, def, caller) {
  return fns.reduce((par, fn) => {
    return function(...args) {
      return caller(par, fn, this, args);
    };
  }, def);
}

function fnType(fn) {
  return create(this, { fn: valueEnumerable(fn) });
}

let reduceType = {};
/**
 * A `reduce` takes a reducer function for changing the context of the machine. A common use case is to set values coming from form fields.
 *
 * @param reduceFunction A Function that can receive *context* and *event* and will return the context.
 */
export const reduce: <C>(reduceFunction?: ReduceFunction<C>) => Reducer<C> = fnType.bind(reduceType);
/**
 * An `action` function takes a function that will be run during a transition. The primary purpose of using action is to perform side-effects.
 *
 * @param actionFunction A Function that can receive *context*, returned values are discarded.
 */
export const action: <C>(actionFunction?: ActionFunction<C>)=> Action<C> =  fn => reduce((ctx, ev) => !!~fn(ctx, ev) && ctx);

const guardType = {};
/**
 * A `guard` is a method that determines if a transition can proceed.
 * Returning true allows the transition to occur, returning false prevents it from doing so and leaves the state in its current place.
 *
 * @param guardFunction A Function that can receive *context* and will return true or false.
 */
export const guard: <C>(guardFunction?: GuardFunction<C>) => Guard<C> = fnType.bind(guardType);

function filter(Type, arr) {
  return arr.filter(value => Type.isPrototypeOf(value));
}

function makeTransition(from, to, ...args) {
  let guards = stack(filter(guardType, args).map(t => t.fn), truthy, callBoth);
  let reducers = stack(filter(reduceType, args).map(t => t.fn), identity, callForward);
  return create(this, {
    from: valueEnumerable(from),
    to: valueEnumerable(to),
    guards: valueEnumerable(guards),
    reducers: valueEnumerable(reducers)
  });
}

let transitionType = {};
let immediateType = {};
/**
 * A `transition` function is used to move from one state to another.
 *
 * @param event - This will give the name of the event that triggers this transition.
 * @param state - The name of the destination state.
 * @param args - Any extra argument will be evaluated to check if they are one of Reducer, Guard or Action.
 */
export const transition: <C>(
  event: string,
  state: string,
  ...args: (Reducer<C> | Guard<C> | Action<C>)[]
) => Transition = makeTransition.bind(transitionType);

/**
 * An `immediate` function is a type of transition that occurs immediately; it doesn't wait for an event to proceed.
 * This is a state that immediately proceeds to the next.
 *
 * @param state - The name of the destination state.
 * @param args - Any extra argument will be evaluated to check if they are a Reducer or a Guard.
 */
export const immediate: <C>(
  state: string,
  ...args: (Reducer<C> | Guard<C>)[]
): Transition = makeTransition.bind(immediateType, null);

function enterImmediate(machine: Machine, service: Service, event) {
  return transitionTo(service, event, this.immediates) || machine;
}

function transitionsToMap(transitions) {
  let m = new Map();
  for(let t of transitions) {
    if(!m.has(t.from)) m.set(t.from, []);
    m.get(t.from).push(t);
  }
  return m;
}

let stateType = { enter: identity };
/**
 * The `state` function returns a state object. A state can take transitions and immediates as arguments.
 *
 * @param args - Any argument needs to be of type Transition or Immediate.
 */
export function state(...args: (Transition | Immediate)[]): MachineState {
  let transitions = filter(transitionType, args);
  let immediates = filter(immediateType, args);
  let desc = {
    final: valueEnumerable(args.length === 0),
    transitions: valueEnumerable(transitionsToMap(transitions))
  };
  if(immediates.length) {
    desc.immediates = valueEnumerable(immediates);
    desc.enter = valueEnumerable(enterImmediate);
  }
  return create(stateType, desc);
}

let invokeType = {
  enter(machine, service, event) {
    this.fn.call(service, service.context, event)
      .then(data => service.send({ type: 'done', data }))
      .catch(error => service.send({ type: 'error', error }));
    return machine;
  }
};
const machineToThen = machine => function(ctx, ev) {
  return {
    then: resolve => {
      this.child = interpret(machine, s => {
        this.onChange(s);
        if(s.machine.state.value.final) {
          delete this.child;
          resolve(s.context);
        }
      }, ctx, ev);
      return { catch: identity };
    }
  };
};
export function invoke(fn: any, ...transitions: any[]): any {
  return create(invokeType, {
    fn: valueEnumerable(machine.isPrototypeOf(fn) ? machineToThen(fn) : fn),
    transitions: valueEnumerable(transitionsToMap(transitions))
  });
}

let machine = {
  get state() {
    return {
      name: this.current,
      value: this.states[this.current]
    };
  }
};

/**
 * The `createMachine` function creates a state machine. It takes an object of *states* with the key being the state name.
 * The value is usually *state* but might also be *invoke*.
 *
 * @param states - An object of states, where each key is a state name, and the values are one of *state* or *invoke*.
 * @param context - A function that returns an object of extended state values. The function can receive an `event` argument.
 */
export function createMachine<S, C>(
  states: { [K in keyof S]: MachineState },
  contextFn?: ContextFunction<C>
): Machine<typeof states, C, keyof typeof states>;
/**
 * The `createMachine` function creates a state machine. It takes an object of *states* with the key being the state name.
 * The value is usually *state* but might also be *invoke*.
 *
 * @param current - Creates a machine that has *initial* as it's initial state.
 * @param states - An object of states, where each key is a state name, and the values are one of *state* or *invoke*.
 * @param context - A function that returns an object of extended state values. The function can receive an `event` argument.
 */
export function createMachine<S, C>(
  current: keyof S,
  states: { [K in keyof S]: MachineState },
  contextFn: ContextFunction<C> = empty
): Machine<typeof states, C, keyof typeof states> {
  if(typeof initial !== 'string') {
    contextFn = states || empty;
    states = initial;
    initial = Object.keys(states)[0];
  }
  if(d._create) d._create(initial, states);
  return create(machine, {
    context: valueEnumerable(contextFn),
    current: valueEnumerable(initial),
    states: valueEnumerable(states)
  });
}

function transitionTo(service, fromEvent, candidates) {
  let { machine, context } = service;
  for(let { to, guards, reducers } of candidates) {
    if(guards(context, fromEvent)) {
      service.context = reducers.call(service, context, fromEvent);

      let original = machine.original || machine;
      let newMachine = create(original, {
        current: valueEnumerable(to),
        original: { value: original }
      });

      let state = newMachine.state.value;
      return state.enter(newMachine, service, fromEvent);
    }
  }
}

function send(service, event) {
  let eventName = event.type || event;
  let { machine } = service;
  let { value: state } = machine.state;

  if(state.transitions.has(eventName)) {
    return transitionTo(service, event, state.transitions.get(eventName)) || machine;
  }
  return machine;
}

let service = {
  send(event) {
    this.machine = send(this, event);

    // TODO detect change
    this.onChange(this);
  }
};

  /**
   * The `interpret` function takes a machine and creates a service that can send events into the machine, changing its states.
   * A service does not mutate a machine, but rather creates derived machines with the current state set.
   *
   * @param machine The state `machine`, created with *createMachine* to create a new service for.
   * @param onChange A callback that is called when the machine completes a transition. Even if the transition results in returning to the same state, the `onChange` callback is still called.
   * @param event The `event` can be any object. It is passed to the context function
   */
  export function interpret<M extends Machine, E>(
    machine: M,
    onChange?: InterpretOnChangeFunction<typeof machine>,
    initialContext?: M['context'],
    event?: { [K in keyof E]: any }
  ): Service<typeof machine> {
  let s = Object.create(service, {
    machine: valueEnumerableWritable(machine),
    context: valueEnumerableWritable(machine.context(initialContext, event)),
    onChange: valueEnumerable(onChange)
  });
  s.send = s.send.bind(s);
  s.machine = s.machine.state.value.enter(s.machine, s, event);
  return s;
}


/* General Types */

export type ContextFunction<T> = (context: T, event: unknown) => T

export type GuardFunction<T> = (context: T, event: unknown) => boolean

export type ActionFunction<T> = (context: T, event: unknown) => boolean

export type ReduceFunction<T> = (context: T, event: unknown) => T

export type InterpretOnChangeFunction<T extends Machine> = (
  service: Service<T>
) => void

export type SendEvent = string | { type: string; [key: string]: any }
export type SendFunction<T = SendEvent> = (event: T) => void

export type Machine<S = {}, C = {}, K = string> = {
  context: C
  current: K
  states: S
  state: {
    name: K
    value: MachineState
  }
}

export type Action<C> = {
  fn: (context: C) => void
}

export type Reducer<C> = {
  fn: (context: C, event: unknown) => C
}

export type Guard<C> = {
  fn: (context: C) => boolean
}

export interface MachineState {
  final: boolean
  transitions: Map<string, Transition[]>
  immediates?: Map<string, Immediate[]>
  enter?: any
}

export interface Transition {
  from: string | null
  to: string
  guards: any[]
  reducers: any[]
}

export interface Service<M extends Machine> {
  machine: M
  context: M['context']
  onChange: InterpretOnChangeFunction<M>
  send: SendFunction
}

export type Immediate = Transition
