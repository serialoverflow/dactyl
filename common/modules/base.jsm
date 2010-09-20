// Copyright (c) 2009-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let objproto = Object.prototype;
let hasOwnProperty = objproto.hasOwnProperty;

if (!Object.create)
    Object.create = function (proto, props) {
        let obj = { __proto__: proto };
        for (let k in properties(props || {}))
            Object.defineProperty(obj, k, props[k]);
        return obj;
    };
if (!Object.defineProperty)
    Object.defineProperty = function (obj, prop, desc) {
        let value = desc.value;
        if ("value" in desc)
            if (desc.writable && !objproto.__lookupGetter__.call(obj, prop)
                              && !objproto.__lookupSetter__.call(obj, prop))
                obj[prop] = value;
            else {
                objproto.__defineGetter__.call(obj, prop, function () value);
                if (desc.writable)
                    objproto.__defineSetter__.call(obj, prop, function (val) { value = val; });
            }

        if ("get" in desc)
            objproto.__defineGetter__.call(obj, prop, desc.get);
        if ("set" in desc)
            objproto.__defineSetter__.call(obj, prop, desc.set);
    }
if (!Object.getOwnPropertyDescriptor)
    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(obj, prop) {
        if (!hasOwnProperty.call(obj, prop))
            return undefined;
        let desc = {
            configurable: true,
            enumerable: objproto.propertyIsEnumerable.call(obj, prop),
        };
        var get = obj.__lookupGetter__(prop),
            set = obj.__lookupSetter__(prop);
        if (!get && !set) {
            desc.value = obj[prop];
            desc.writable = true;
        }
        if (get)
            desc.get = get;
        if (set)
            desc.set = set;
        return desc;
    }
if (!Object.getOwnPropertyNames)
    Object.getOwnPropertyNames = function getOwnPropertyNames(obj) {
        // This is an ugly and unfortunately necessary hack.
        if (hasOwnProperty.call(obj, "__iterator__")) {
            var oldIter = obj.__iterator__;
            delete obj.__iterator__;
        }
        let res = [k for (k in obj) if (hasOwnProperty.call(obj, k))];
        if (oldIter !== undefined) {
            obj.__iterator__ = oldIter;
            res.push("__iterator__");
        }
        return res;
    };
if (!Object.getPrototypeOf)
    Object.getPrototypeOf = function (obj) obj.__proto__;
if (!Object.keys)
    Object.keys = function (obj)
        Object.getOwnPropertyNames(obj).filter(function (k) objproto.propertyIsEnumerable.call(obj, k));

let use = {};
let loaded = {};
let currentModule;
function defmodule(name, params) {
    let module = Cu.getGlobalForObject ? Cu.getGlobalForObject(params) : params.__parent__;
    module.NAME = name;
    module.EXPORTED_SYMBOLS = params.exports || [];
    defmodule.loadLog.push("defmodule " + name);
    for(let [, mod] in Iterator(params.require || []))
        require(module, mod);

    for(let [, mod] in Iterator(params.use || []))
        if (loaded.hasOwnProperty(mod))
            require(module, mod, "use");
        else {
            use[mod] = use[mod] || [];
            use[mod].push(module);
        }
    currentModule = module;
}

defmodule.loadLog = [];
Object.defineProperty(defmodule.loadLog, "push", { value: function (val) { dump(val + "\n"); this[this.length] = val } });
defmodule.modules = [];
defmodule.times = { all: 0 };
defmodule.time = function time(major, minor, func, self) {
    let time = Date.now();
    let res = func.apply(self, Array.slice(arguments, 4));
    let delta = Date.now() - time;
    defmodule.times.all += delta;
    defmodule.times[major] = (defmodule.times[major] || 0) + delta;
    if (minor) {
        defmodule.times[":" + minor] = (defmodule.times[":" + minor] || 0) + delta;
        defmodule.times[major + ":" + minor] = (defmodule.times[major + ":" + minor] || 0) + delta;
    }
    return res;
}

function endmodule() {
    defmodule.loadLog.push("endmodule " + currentModule.NAME);
    loaded[currentModule.NAME] = 1;
    for(let [, mod] in Iterator(use[currentModule.NAME] || []))
        require(mod, currentModule.NAME, "use");
}

function require(obj, name, from) {
    try {
        defmodule.loadLog.push((from || "require") + ": loading " + name + " into " + obj.NAME);
        Cu.import("resource://dactyl/" + name + ".jsm", obj);
    }
    catch (e) {
        dump("loading " + String.quote("resource://dactyl/" + name + ".jsm") + "\n");
        dump("    " + e.fileName + ":" + e.lineNumber + ": " + e +"\n");
    }
}

defmodule("base", {
    // sed -n 's/^(const|function) ([a-zA-Z0-9_]+).*/	"\2",/p' base.jsm | sort | fmt
    exports: [
        "Cc", "Ci", "Class", "Cr", "Cu", "Module", "Object", "Runnable",
        "Struct", "StructBase", "Timer", "UTF8", "XPCOMUtils", "array",
        "call", "callable", "curry", "debuggerProperties", "defmodule",
        "endmodule", "extend", "foreach", "isarray", "isgenerator",
        "isinstance", "isobject", "isstring", "issubclass", "iter", "iterall",
        "keys", "memoize", "properties", "requiresMainThread", "set",
        "update", "values",
    ],
    use: ["services"]
});

function Runnable(self, func, args) {
    return {
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIRunnable]),
        run: function () { func.apply(self, args || []); }
    };
}

/**
 * Returns a list of all of the top-level properties of an object, by
 * way of the debugger.
 *
 * @param {object} obj
 * @returns [jsdIProperty]
 */
function debuggerProperties(obj) {
    if (loaded.services && services.get("debugger").isOn) {
        let ret = {};
        services.get("debugger").wrapValue(obj).getProperties(ret, {});
        return ret.value;
    }
}

/**
 * Iterates over the names of all of the top-level properties of an
 * object or, if prototypes is given, all of the properties in the
 * prototype chain below the top. Uses the debugger if possible.
 *
 * @param {object} obj The object to inspect.
 * @param {boolean} properties Whether to inspect the prototype chain
 * @default false
 * @returns {Generator}
 */
function properties(obj, prototypes, debugger_) {
    let orig = obj;
    let seen = {};
    for (; obj; obj = prototypes && obj.__proto__) {
        try {
            var iter = (!debugger_ || !services.get("debugger").isOn) && values(Object.getOwnPropertyNames(obj));
        }
        catch (e) {}
        if (!iter)
            iter = (prop.name.stringValue for (prop in values(debuggerProperties(obj))));

        for (let key in iter)
            if (!prototypes || !set.add(seen, key) && obj != orig)
                yield key
    }
}

/**
 * Iterates over all of the top-level, iterable property names of an
 * object.
 *
 * @param {object} obj The object to inspect.
 * @returns {Generator}
 */
function keys(obj) {
    for (var k in obj)
        if (hasOwnProperty.call(obj, k))
            yield k;
}
/**
 * Iterates over all of the top-level, iterable property values of an
 * object.
 *
 * @param {object} obj The object to inspect.
 * @returns {Generator}
 */
function values(obj) {
    for (var k in obj)
        if (hasOwnProperty.call(obj, k))
            yield obj[k];
}

/**
 * Iterates over an iterable object and calls a callback for each
 * element.
 *
 * @param {object} iter The iterator.
 * @param {function} fn The callback.
 * @param {object} self The this object for 'fn'.
 */
function foreach(iter, fn, self) {
    for (let val in iter)
        fn.call(self, val);
}

/**
 * Iterates over each iterable argument in turn, yielding each value.
 *
 * @returns {Generator}
 */
function iterall() {
    for (let i = 0; i < arguments.length; i++)
        for (let j in Iterator(arguments[i]))
            yield j;
}

/**
 * Utility for managing sets of strings. Given an array, returns an
 * object with one key for each value thereof.
 *
 * @param {[string]} ary @optional
 * @returns {object}
 */
function set(ary) {
    let obj = {};
    if (ary)
        for (var i = 0; i < ary.length; i++)
            obj[ary[i]] = true;
    return obj;
}
/**
 * Adds an element to a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to add.
 * @returns boolean
 */
set.add = function (set, key) {
    let res = this.has(set, key);
    set[key] = true;
    return res;
}
/**
 * Returns true if the given set contains the given key.
 *
 * @param {object} set The set.
 * @param {string} key The key to check.
 * @returns {boolean}
 */
set.has = function (set, key) hasOwnProperty.call(set, key);
/**
 * Returns a new set containing the members of the first argument which
 * do not exist in any of the other given arguments.
 *
 * @param {object} set The set.
 * @returns {object}
 */
set.subtract = function (set) {
    set = update({}, set);
    for (let i = 1; i < arguments.length; i++)
        for (let k in keys(arguments[i]))
            delete set[k];
    return set;
}
/**
 * Removes an element from a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to remove.
 * @returns boolean
 */
set.remove = function (set, key) {
    let res = set.has(set, key);
    delete set[key];
    return res;
}

/**
 * Iterates over an arbitrary object. The following iterators types are
 * supported, and work as a user would expect:
 *
 *  • nsIDOMNodeIterator
 *  • mozIStorageStatement
 *
 * Additionally, the following array-like objects yield a tuple of the
 * form [index, element] for each contained element:
 *
 *  • nsIDOMHTMLCollection
 *  • nsIDOMNodeList
 *
 * and the following likewise yield one element of the form
 * [name, element] for each contained element:
 *
 *  • nsIDOMNamedNodeMap
 *
 * Duck typing is implemented for the any other type. If the object
 * contains the "enumerator" property, iter is called on that. If the
 * property is a function, it is called first. If it contains the
 * property "getNext" along with either "hasMoreItems" or "hasMore", it
 * is iterated over appropriately.
 *
 * For all other cases, this function behaves exactly like the Iterator
 * function.
 *
 * @param {object} obj
 * @returns {Generator}
 */
function iter(obj) {
    if (isinstance(obj, [Ci.nsIDOMHTMLCollection, Ci.nsIDOMNodeList]))
        return array.iteritems(obj);
    if (obj instanceof Ci.nsIDOMNamedNodeMap)
        return (function () {
            for (let i = 0; i < obj.length; i++)
                yield [obj.name, obj];
        })();
    if (obj instanceof Ci.mozIStorageStatement)
        return (function (obj) {
            while (obj.executeStep())
                yield obj.row;
            obj.reset();
        })(obj);
    if ("getNext" in obj) {
        if ("hasMoreElements" in obj)
            return (function () {
                while (obj.hasMoreElements())
                    yield obj.getNext();
            })();
        if ("hasMore" in obj)
            return (function () {
                while (obj.hasMore())
                    yield obj.getNext();
            })();
    }
    if ("enumerator" in obj) {
        if (callable(obj.enumerator))
            return iter(obj.enumerator());
        return iter(obj.enumerator);
    }
    return Iterator(obj);
}

/**
 * Returns true if both arguments are functions and
 * (targ() instaneof src) would also return true.
 *
 * @param {function} targ
 * @param {function} src
 * @returns {boolean}
 */
function issubclass(targ, src) {
    return src === targ ||
        targ && typeof targ === "function" && targ.prototype instanceof src;
}

/**
 * Returns true if targ is an instance or src. If src is an array,
 * returns true if targ is an instance of any element of src. If src is
 * the object form of a primitive type, returns true if targ is a
 * non-boxed version of the type, i.e., if (typeof targ == "string"),
 * isinstance(targ, String) is true. Finally, if src is a string,
 * returns true if ({}.toString.call(targ) == "[object <src>]").
 *
 * @param {object} targ The object to check.
 * @param {object|string|[object|string]} src The types to check targ against.
 * @returns {boolean}
 */
function isinstance(targ, src) {
    const types = {
        boolean: Boolean,
        string: String,
        function: Function,
        number: Number
    }
    src = Array.concat(src);
    for (var i = 0; i < src.length; i++) {
        if (typeof src[i] === "string") {
            if (objproto.toString.call(targ) === "[object " + src[i] + "]")
                return true;
        }
        else {
            if (targ instanceof src[i])
                return true;
            var type = types[typeof targ];
            if (type && issubclass(src[i], type))
                return true;
        }
    }
    return false;
}

/**
 * Returns true if obj is a non-null object.
 */
function isobject(obj) typeof obj === "object" && obj != null;

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Array type. The array may come from
 * any window, frame, namespace, or execution context, which
 * is not the case when using (obj instanceof Array).
 */
const isarray = Array.isArray ||
    function isarray(val) objproto.toString.call(val) == "[object Array]";

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Generator type. This includes
 * functions containing the 'yield' statement and generator
 * statements such as (x for (x in obj)).
 */
function isgenerator(val) objproto.toString.call(val) == "[object Generator]";

/**
 * Returns true if and only if its sole argument is a String,
 * as defined by the builtin type. May be constructed via
 * String(foo) or new String(foo) from any window, frame,
 * namespace, or execution context, which is not the case when
 * using (obj instanceof String) or (typeof obj == "string").
 */
function isstring(val) objproto.toString.call(val) == "[object String]";

/**
 * Returns true if and only if its sole argument may be called
 * as a function. This includes classes and function objects.
 */
function callable(val) typeof val === "function";

function call(fn) {
    fn.apply(arguments[1], Array.slice(arguments, 2));
    return fn;
}

/**
 * Memoizes an object property value.
 *
 * @param {object} obj The object to add the property to.
 * @param {string} key The property name.
 * @param {function} getter The function which will return the initial
 * value of the property.
 */
function memoize(obj, key, getter) {
    obj.__defineGetter__(key, function ()
        Class.replaceProperty(this, key, getter.call(this, key)));
}

/**
 * Curries a function to the given number of arguments. Each
 * call of the resulting function returns a new function. When
 * a call does not contain enough arguments to satisfy the
 * required number, the resulting function is another curried
 * function with previous arguments accumulated.
 *
 *     function foo(a, b, c) [a, b, c].join(" ");
 *     curry(foo)(1, 2, 3) -> "1 2 3";
 *     curry(foo)(4)(5, 6) -> "4 5 6";
 *     curry(foo)(7)(8)(9) -> "7 8 9";
 *
 * @param {function} fn The function to curry.
 * @param {integer} length The number of arguments expected.
 *     @default fn.length
 *     @optional
 * @param {object} self The 'this' value for the returned function. When
 *     omitted, the value of 'this' from the first call to the function is
 *     preserved.
 *     @optional
 */
function curry(fn, length, self, acc) {
    if (length == null)
        length = fn.length;
    if (length == 0)
        return fn;

    // Close over function with 'this'
    function close(self, fn) function () fn.apply(self, Array.slice(arguments));

    if (acc == null)
        acc = [];

    return function curried() {
        let args = acc.concat(Array.slice(arguments));

        // The curried result should preserve 'this'
        if (arguments.length == 0)
            return close(self || this, curried);

        if (args.length >= length)
            return fn.apply(self || this, args);

        return curry(fn, length, self || this, args);
    };
}

/**
 * Wraps a function so that when called it will always run synchronously
 * in the main thread. Return values are not preserved.
 *
 * @param {function}
 * @returns {function}
 */
function requiresMainThread(callback)
    function wrapper() {
        let mainThread = services.get("threadManager").mainThread;
        if (services.get("threadManager").isMainThread)
            callback.apply(this, arguments);
        else
            mainThread.dispatch(Runnable(this, callback, arguments), mainThread.DISPATCH_NORMAL);
    }

/**
 * Updates an object with the properties of another object. Getters
 * and setters are copied as expected. Moreover, any function
 * properties receive new 'supercall' and 'superapply' properties,
 * which will call the identically named function in target's
 * prototype.
 *
 *    let a = { foo: function (arg) "bar " + arg }
 *    let b = { __proto__: a }
 *    update(b, { foo: function foo() foo.supercall(this, "baz") });
 *
 *    a.foo("foo") -> "bar foo"
 *    b.foo()      -> "bar baz"
 *
 * @param {Object} target The object to update.
 * @param {Object} src The source object from which to update target.
 *    May be provided multiple times.
 * @returns {Object} Returns its updated first argument.
 */
function update(target) {
    for (let i = 1; i < arguments.length; i++) {
        let src = arguments[i];
        Object.getOwnPropertyNames(src || {}).forEach(function (k) {
            let desc = Object.getOwnPropertyDescriptor(src, k);
            if (desc.value && callable(desc.value) && Object.getPrototypeOf(target)) {
                let func = desc.value;
                desc.value.superapply = function (self, args)
                    Object.getPrototypeOf(target)[k].apply(self, args);
                desc.value.supercall = function (self)
                    func.superapply(self, Array.slice(arguments, 1));
            }
            Object.defineProperty(target, k, desc);
        });
    }
    return target;
}

/**
 * Extends a subclass with a superclass. The subclass's
 * prototype is replaced with a new object, which inherits
 * from the superclass's prototype, {@see update}d with the
 * members of 'overrides'.
 *
 * @param {function} subclass
 * @param {function} superclass
 * @param {Object} overrides @optional
 */
function extend(subclass, superclass, overrides) {
    subclass.superclass = superclass;

    try {
        subclass.prototype = Object.create(superclass.prototype);
    }
    catch(e) {
        dump(e + "\n" + String.replace(e.stack, /^/gm, "    ") + "\n\n");
    }
    update(subclass.prototype, overrides);
    subclass.prototype.constructor = subclass;
    subclass.prototype._class_ = subclass;

    if (superclass.prototype.constructor === objproto.constructor)
        superclass.prototype.constructor = superclass;
}

/**
 * @constructor Class
 *
 * Constructs a new Class. Arguments marked as optional must be
 * either entirely elided, or they must have the exact type
 * specified.
 *
 * @param {string} name The class's as it will appear when toString
 *     is called, as well as in stack traces.
 *     @optional
 * @param {function} base The base class for this module. May be any
 *     callable object.
 *     @optional
 *     @default Class
 * @param {Object} prototype The prototype for instances of this
 *     object. The object itself is copied and not used as a prototype
 *     directly.
 * @param {Object} classProperties The class properties for the new
 *     module constructor. More than one may be provided.
 *     @optional
 *
 * @returns {function} The constructor for the resulting class.
 */
function Class() {

    var args = Array.slice(arguments);
    if (isstring(args[0]))
        var name = args.shift();
    var superclass = Class;
    if (callable(args[0]))
        superclass = args.shift();

    var Constructor = eval(String.replace(<![CDATA[
        (function constructor() {
            let self = Object.create(Constructor.prototype, {
                constructor: { value: Constructor },
                closure: {
                    configurable: true,
                    get: function () {
                        function closure(fn) function () fn.apply(self, arguments);
                        for (let k in iterall(properties(this),
                                              properties(this, true)))
                            if (!this.__lookupGetter__(k) && callable(this[k]))
                                closure[k] = closure(self[k]);
                        Object.defineProperty(this, "closure", { value: closure });
                        return closure;
                    }
                }
            });
            var res = self.init.apply(self, arguments);
            return res !== undefined ? res : self;
        })]]>,
        "constructor", (name || superclass.classname).replace(/\W/g, "_")));
    Constructor.classname = name || superclass.classname || superclass.name;

    if ("init" in superclass.prototype)
        Constructor.__proto__ = superclass;
    else {
        let superc = superclass;
        superclass = function Shim() {};
        extend(superclass, superc, {
            init: superc
        });
        superclass.__proto__ = superc;
    }

    extend(Constructor, superclass, args[0]);
    update(Constructor, args[1]);
    Constructor.__proto__ = superclass;
    args = args.slice(2);
    Array.forEach(args, function (obj) {
        if (callable(obj))
            obj = obj.prototype;
        update(Constructor.prototype, obj);
    });
    return Constructor;
}
Class.replaceProperty = function (obj, prop, value) {
    Object.defineProperty(obj, prop, { configurable: true, enumerable: true, value: value, writable: true });
    return value;
};
Class.toString = function () "[class " + this.classname + "]";
Class.prototype = {
    /**
     * Initializes new instances of this class. Called automatically
     * when new instances are created.
     */
    init: function () {},

    toString: function () "[instance " + this.constructor.classname + "]",

    /**
     * Executes 'callback' after 'timeout' milliseconds. The value of
     * 'this' is preserved in the invocation of 'callback'.
     *
     * @param {function} callback The function to call after 'timeout'
     * @param {number} timeout The time, in milliseconds, to wait
     *     before calling 'callback'.
     * @returns {nsITimer} The timer which backs this timeout.
     */
    timeout: function (callback, timeout) {
        const self = this;
        let notify = { notify: function notify(timer) { callback.call(self) } };
        let timer = services.create("timer");
        timer.initWithCallback(notify, timeout, timer.TYPE_ONE_SHOT);
        return timer;
    }
};

/**
 * Constructs a mew Module class and instantiates an instance into the current
 * module global object.
 *
 * @param {string} name The name of the instance.
 * @param {Object} prototype The instance prototype.
 * @param {Object} classProperties Properties to be applied to the class constructor.
 * @returns {Class}
 */
function Module(name, prototype) {
    let init = callable(prototype) ? 4 : 3;
    const module = Class.apply(Class, Array.slice(arguments, 0, init));
    let instance = module();
    module.classname = name.toLowerCase();
    instance.INIT = arguments[init] || {};
    currentModule[module.classname] = instance;
    defmodule.modules.push(instance);
    return module;
}
if (Cu.getGlobalForObject)
    Module.callerGlobal = function (caller) {
        try {
            return Cu.getGlobalForObject(caller);
        }
        catch (e) {
            return null;
        }
    };
else
    Module.callerGlobal = function (caller) {
        while (caller.__parent__)
            caller = caller.__parent__;
        return caller;
    };

/**
 * @class Struct
 *
 * Creates a new Struct constructor, used for creating objects with
 * a fixed set of named members. Each argument should be the name of
 * a member in the resulting objects. These names will correspond to
 * the arguments passed to the resultant constructor. Instances of
 * the new struct may be treated very much like arrays, and provide
 * many of the same methods.
 *
 *     const Point = Struct("x", "y", "z");
 *     let p1 = Point(x, y, z);
 *
 * @returns {function} The constructor for the new Struct.
 */
function Struct() {
    let args = Array.slice(arguments);
    const Struct = Class("Struct", StructBase, {
        length: args.length,
        members: args
    });
    args.forEach(function (name, i) {
        Struct.prototype.__defineGetter__(name, function () this[i]);
        Struct.prototype.__defineSetter__(name, function (val) { this[i] = val; });
    });
    return Struct;
}
let StructBase = Class("StructBase", Array, {
    init: function () {
        for (let i = 0; i < arguments.length; i++)
            if (arguments[i] != undefined)
                this[i] = arguments[i];
    },

    clone: function clone() this.constructor.apply(null, this.slice()),

    // Iterator over our named members
    __iterator__: function () {
        let self = this;
        return ([k, self[k]] for (k in values(self.members)))
    }
}, {
    fromArray: function (ary) {
        ary.__proto__ = this.prototype;
        return ary;
    },

    /**
     * Sets a lazily constructed default value for a member of
     * the struct. The value is constructed once, the first time
     * it is accessed and memoized thereafter.
     *
     * @param {string} key The name of the member for which to
     *     provide the default value.
     * @param {function} val The function which is to generate
     *     the default value.
     */
    defaultValue: function (key, val) {
        let i = this.prototype.members.indexOf(key);
        this.prototype.__defineGetter__(i, function () (this[i] = val.call(this)));
        this.prototype.__defineSetter__(i, function (value)
            Class.replaceProperty(this, i, value));
    }
});

const Timer = Class("Timer", {
    init: function (minInterval, maxInterval, callback) {
        this._timer = services.create("timer");
        this.callback = callback;
        this.minInterval = minInterval;
        this.maxInterval = maxInterval;
        this.doneAt = 0;
        this.latest = 0;
    },

    notify: function (timer) {
        this._timer.cancel();
        this.latest = 0;
        // minInterval is the time between the completion of the command and the next firing
        this.doneAt = Date.now() + this.minInterval;

        try {
            this.callback(this.arg);
        }
        finally {
            this.doneAt = Date.now() + this.minInterval;
        }
    },

    tell: function (arg) {
        if (arguments.length > 0)
            this.arg = arg;

        let now = Date.now();
        if (this.doneAt == -1)
            this._timer.cancel();

        let timeout = this.minInterval;
        if (now > this.doneAt && this.doneAt > -1)
            timeout = 0;
        else if (this.latest)
            timeout = Math.min(timeout, this.latest - now);
        else
            this.latest = now + this.maxInterval;

        this._timer.initWithCallback(this, Math.max(timeout, 0), this._timer.TYPE_ONE_SHOT);
        this.doneAt = -1;
    },

    reset: function () {
        this._timer.cancel();
        this.doneAt = 0;
    },

    flush: function () {
        if (this.doneAt == -1)
            this.notify();
    }
});

/**
 * Returns the UTF-8 encoded value of a string mis-encoded into
 * ISO-8859-1.
 *
 * @param {string} str
 * @returns {string}
 */
function UTF8(str) {
    try {
        return decodeURIComponent(escape(str))
    }
    catch (e) {
        return str
    }
}

/**
 * Array utility methods.
 */
const array = Class("array", Array, {
    init: function (ary) {
        if (isinstance(ary, ["Iterator", "Generator"]))
            ary = [k for (k in ary)];
        else if (ary.length)
            ary = Array.slice(ary);

        return {
            __proto__: ary,
            __iterator__: function () this.iteritems(),
            __noSuchMethod__: function (meth, args) {
                var res = array[meth].apply(null, [this.array].concat(args));
                if (isarray(res))
                    return array(res);
                return res;
            },
            array: ary,
            toString: function () this.array.toString(),
            concat: function () this.array.concat.apply(this.array, arguments),
            filter: function () this.__noSuchMethod__("filter", Array.slice(arguments)),
            map: function () this.__noSuchMethod__("map", Array.slice(arguments))
        };
    }
}, {
    /**
     * Converts an array to an object. As in lisp, an assoc is an
     * array of key-value pairs, which maps directly to an object,
     * as such:
     *    [["a", "b"], ["c", "d"]] -> { a: "b", c: "d" }
     *
     * @param {Array[]} assoc
     * @... {string} 0 - Key
     * @...          1 - Value
     */
    toObject: function toObject(assoc) {
        let obj = {};
        assoc.forEach(function ([k, v]) { obj[k] = v; });
        return obj;
    },

    /**
     * Compacts an array, removing all elements that are null or undefined:
     *    ["foo", null, "bar", undefined] -> ["foo", "bar"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    compact: function compact(ary) ary.filter(function (item) item != null),

    /**
     * Flattens an array, such that all elements of the array are
     * joined into a single array:
     *    [["foo", ["bar"]], ["baz"], "quux"] -> ["foo", ["bar"], "baz", "quux"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    flatten: function flatten(ary) ary.length ? Array.concat.apply([], ary) : [],

    /**
     * Returns an Iterator for an array's values.
     *
     * @param {Array} ary
     * @returns {Iterator(Object)}
     */
    itervalues: function itervalues(ary) {
        let length = ary.length;
        for (let i = 0; i < length; i++)
            yield ary[i];
    },

    /**
     * Returns an Iterator for an array's indices and values.
     *
     * @param {Array} ary
     * @returns {Iterator([{number}, {Object}])}
     */
    iteritems: function iteritems(ary) {
        let length = ary.length;
        for (let i = 0; i < length; i++)
            yield [i, ary[i]];
    },

    /**
     * Filters out all duplicates from an array. If
     * <b>unsorted</b> is false, the array is sorted before
     * duplicates are removed.
     *
     * @param {Array} ary
     * @param {boolean} unsorted
     * @returns {Array}
     */
    uniq: function uniq(ary, unsorted) {
        let ret = [];
        if (unsorted) {
            for (let [, item] in Iterator(ary))
                if (ret.indexOf(item) == -1)
                    ret.push(item);
        }
        else {
            for (let [, item] in Iterator(ary.sort())) {
                if (item != last || !ret.length)
                    ret.push(item);
                var last = item;
            }
        }
        return ret;
    },

    /**
     * Zips the contents of two arrays. The resulting array is the length of
     * ary1, with any shortcomings of ary2 replaced with null strings.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {Array}
     */
    zip: function zip(ary1, ary2) {
        let res = []
        for(let [i, item] in Iterator(ary1))
            res.push([item, i in ary2 ? ary2[i] : ""]);
        return res;
    }
});

endmodule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript: